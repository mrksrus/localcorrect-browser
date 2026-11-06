#!/usr/bin/env python3
"""Fine-tune a local pretrained BERT Mini encoder for sparse KEEP/edit decisions.

Only parallel split=train rows supply supervision. No masks are inserted
into input text, and no calibration/test rows or correction thresholds are used.
The frozen action vocabulary is verified against train-only mining before use.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import re
import resource
import time

BASE_SPEC = importlib.util.spec_from_file_location("context_training", Path(__file__).with_name("train-context.py"))
BASE = importlib.util.module_from_spec(BASE_SPEC)
BASE_SPEC.loader.exec_module(BASE)
FORMAT = "localcorrect-context-encoder-v1"
MAX_LENGTH, CANDIDATE_WIDTH = 128, 9


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PortableWordPiece:
    """Cased greedy WordPiece over the shared tokens, with no hidden tokenizer."""
    def __init__(self, vocab_path):
        self.words = vocab_path.read_text().splitlines()
        self.vocab = {word: index for index, word in enumerate(self.words)}
        self.pad, self.unk = self.vocab["[PAD]"], self.vocab["[UNK]"]
        self.cls, self.sep = self.vocab["[CLS]"], self.vocab["[SEP]"]
        self.cache = {}

    def pieces(self, surface):
        if surface in self.cache:
            return self.cache[surface]
        output = []
        # Shared tokens may contain apostrophes. BERT basic tokenization splits
        # those before greedy WordPiece; all other punctuation is already split.
        for part in re.findall(r"[^'’]+|['’]", surface):
            if len(part) > 100:
                output.append(self.unk)
                continue
            start, result = 0, []
            while start < len(part):
                found = None
                for end in range(len(part), start, -1):
                    candidate = ("##" if start else "") + part[start:end]
                    if candidate in self.vocab:
                        found = (end, self.vocab[candidate])
                        break
                if found is None:
                    result = [self.unk]
                    break
                start, token_id = found
                result.append(token_id)
            output.extend(result)
        if not output or len(output) > MAX_LENGTH-2:
            output = [self.unk]
        self.cache[surface] = output
        return output

    def chunks(self, text):
        tokens = BASE.tokenize(text)
        chunks, ids, indices, positions = [], [self.cls], [], []

        def flush():
            nonlocal ids, indices, positions
            if indices:
                chunks.append({"input_ids": ids + [self.sep], "token_indices": indices,
                               "first_positions": positions})
            ids, indices, positions = [self.cls], [], []
        for index, (surface, start, end) in enumerate(tokens):
            pieces = self.pieces(surface)
            if len(ids) + len(pieces) + 1 > MAX_LENGTH:
                flush()
            indices.append(index)
            positions.append(len(ids))
            ids.extend(pieces)
            gap = text[end:tokens[index+1][1]] if index+1 < len(tokens) else ""
            if surface in (".", "!", "?") or "\n" in gap or "\r" in gap:
                flush()
        flush()
        return tokens, chunks


def verified_actions(action_model, rows):
    parsed = [(row, *BASE.aligned(row)) for row in rows]
    counts = Counter(label for _, _, labels in parsed for label in labels if isinstance(label, tuple))
    settings = action_model["training"]
    selected, by_trigger = BASE.mine_actions(counts, settings["minCount"], settings["maxActions"],
                                           settings["maxPerTrigger"], settings.get("balanceLanguages", False))
    expected = [(action["language"], action["trigger"], action["kind"], action["replacement"])
                for action in action_model["actions"][1:]]
    if selected != expected or by_trigger != action_model["candidatesByTrigger"]:
        raise ValueError("Frozen action rows differ from train-only mining")
    if any(counts[key] != action_model["actions"][i+1]["trainCount"] for i, key in enumerate(selected)):
        raise ValueError("Frozen action support differs from train-only counts")
    return parsed, {key: i+1 for i, key in enumerate(selected)}


def prepare_examples(parsed, action_model, action_ids, tokenizer):
    examples, positive_indices, negative_indices, counts = [], [], [], Counter()

    def append(text, labels, language, identity):
        tokens, chunks = tokenizer.chunks(text)
        for chunk in chunks:
            positions, candidates, targets = [], [], []
            for index, position in zip(chunk["token_indices"], chunk["first_positions"]):
                token, label = tokens[index][0], labels[index]
                options = action_model["candidatesByTrigger"].get(language + "|" + token)
                if not options:
                    continue
                if label is None or isinstance(label, tuple) and label not in action_ids:
                    counts["maskedUnsupportedOrUnmined"] += 1
                    continue
                row_id = action_ids[label] if isinstance(label, tuple) else 0
                options = [0] + options
                positions.append(position)
                candidates.append(options)
                targets.append(options.index(row_id))
                counts["positive" if row_id else "correctedIdentityKeep" if identity else "originalKeep"] += 1
            if not positions:
                continue
            example = {"input_ids": chunk["input_ids"], "positions": positions,
                       "candidates": candidates, "targets": targets, "language": language}
            example_index = len(examples)
            examples.append(example)
            (positive_indices if any(targets) else negative_indices).append(example_index)
            counts[language + ("PositiveChunks" if any(targets) else "KeepOnlyChunks")] += 1
            counts[language + "PositiveWords"] += sum(target > 0 for target in targets)
            counts[language + "KeepWords"] += sum(target == 0 for target in targets)
    for row, tokens, labels in parsed:
        append(row["input"], labels, row["language"], False)
        corrected = BASE.tokenize(row["expected"])
        append(row["expected"], [0]*len(corrected), row["language"], True)
    if not positive_indices or not negative_indices:
        raise ValueError("Both positive and KEEP-only sentence chunks are required")
    return examples, positive_indices, negative_indices, counts


def collate(examples, pad, torch):
    size, words = max(len(x["input_ids"]) for x in examples), max(len(x["positions"]) for x in examples)
    ids, attention, positions, candidates, masks, targets = [], [], [], [], [], []
    for example in examples:
        if any(not row or row[0] != 0 or len(row) > CANDIDATE_WIDTH or len(set(row)) != len(row)
               for row in example["candidates"]):
            raise ValueError("Sparse candidates must be unique KEEP-first rows within the fixed width")
        n, w = len(example["input_ids"]), len(example["positions"])
        ids.append(example["input_ids"] + [pad]*(size-n))
        attention.append([1]*n + [0]*(size-n))
        positions.append(example["positions"] + [0]*(words-w))
        candidates.append([row + [0]*(CANDIDATE_WIDTH-len(row)) for row in example["candidates"]]
                          + [[0]*CANDIDATE_WIDTH]*(words-w))
        masks.append([[1.0]*len(row)+[0.0]*(CANDIDATE_WIDTH-len(row)) for row in example["candidates"]]
                     + [[0.0]*CANDIDATE_WIDTH]*(words-w))
        targets.append(example["targets"] + [-100]*(words-w))
    inputs = (torch.tensor(ids, dtype=torch.long), torch.tensor(attention, dtype=torch.long),
              torch.tensor(positions, dtype=torch.long), torch.tensor(candidates, dtype=torch.long),
              torch.tensor(masks, dtype=torch.float32))
    return inputs, torch.tensor(targets, dtype=torch.long)


def language_balanced_indices(pools, positive_count, batch_size, step, rng):
    """Equal language/chunk sampling without consulting validation prevalence."""
    result = []
    for groups, count in zip(pools, (positive_count, batch_size-positive_count)):
        languages = sorted(groups)
        for index in range(count):
            language = languages[(step+index) % len(languages)]
            result.append(rng.choice(groups[language]))
    rng.shuffle(result)
    return result


def build_network(pretrained, action_count, torch):
    from transformers import BertConfig, BertModel
    from safetensors.torch import load_file
    config = BertConfig.from_json_file(str(pretrained / "config.json"))
    config._attn_implementation = "eager"
    encoder = BertModel(config, add_pooling_layer=False)
    state = load_file(str(pretrained / "model.safetensors"), device="cpu")
    state = {key[5:]: value for key, value in state.items()
             if key.startswith("bert.") and not key.startswith("bert.pooler.")
             and key != "bert.embeddings.position_ids"}
    encoder.load_state_dict(state, strict=True)

    class EditEncoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = encoder
            self.head = torch.nn.Linear(config.hidden_size, action_count)
            torch.nn.init.normal_(self.head.weight, std=0.02)
            torch.nn.init.zeros_(self.head.bias)

        def forward(self, input_ids, attention_mask, word_positions, candidate_ids, candidate_mask):
            encoded = self.encoder(input_ids=input_ids, attention_mask=attention_mask,
                                   token_type_ids=torch.zeros_like(input_ids), return_dict=False)[0]
            selected = torch.gather(encoded, 1, word_positions.unsqueeze(-1).expand(-1, -1, config.hidden_size))
            weights = torch.nn.functional.embedding(candidate_ids, self.head.weight)
            biases = torch.nn.functional.embedding(candidate_ids, self.head.bias.unsqueeze(-1)).squeeze(-1)
            logits = (selected.unsqueeze(2)*weights).sum(dim=-1) + biases
            return logits.masked_fill(candidate_mask < 0.5, -10000.0)
    return EditEncoder()


SYNTHETIC_TEXTS = [
    ("en", "i put the amber cube beside the lamp."),
    ("en", "The brass clock is beside the blue jar."),
    ("en", "The brass clocks are beside the blue jars."),
    ("en", "Please put this card inside the green box."),
    ("en", "The artist has a silver brush. The artists have silver brushes."),
    ("en", "i\nThe sign reads 'i', followed by a star!"),
    ("de", "Heute steht die kleine Vase neben dem Fenster."),
    ("de", "Neben der Lampe liegt ein grünes Heft."),
    ("de", "Wir stellen das runde Glas auf den Tisch."),
    ("de", "Sie findet den roten Würfel unter dem Stuhl."),
    ("de", "Die blaue Kiste ist dort. Die blauen Kisten sind hier."),
    ("de", "Die Kinder haben einen violetten Ball, das Kind hat einen grünen."),
    ("de", "ich\nAuf dem Regal steht eine gelbe Schale."),
    ("en", "O’Neil's 🚀 is near i.\ufeffThe clock is blue!"),
    ("de", "Ärger ÖL süß ẞ ß? die"),
]


def export_parity(net, tokenizer, action_model, model_sha, torch):
    probes, tokenizer_probes = [], []
    synthetic_texts = list(SYNTHETIC_TEXTS)
    covered = set()
    for trigger, options in sorted(action_model["candidatesByTrigger"].items()):
        language, surface = trigger.split("|", 1)
        shape = (language, len(options))
        if shape not in covered:
            synthetic_texts.append((language, "Amber " + surface + " blue.\n" + surface + "!"))
            covered.add(shape)
    # Repeated public action surfaces exercise truncation without exporting any
    # training sentence. This fixture tests arithmetic, not correction quality.
    if action_model["candidatesByTrigger"]:
        language, surface = sorted(action_model["candidatesByTrigger"])[0].split("|", 1)
        synthetic_texts.append((language, " ".join([surface]*140)+"."))
    for language, text in synthetic_texts:
        tokens, chunks = tokenizer.chunks(text)
        token_rows = [{"text": surface, "start": len(text[:start].encode("utf-16-le"))//2,
                       "end": len(text[:end].encode("utf-16-le"))//2,
                       "pieceIds": tokenizer.pieces(surface)} for surface, start, end in tokens]
        tokenizer_probes.append({"language": language, "text": text, "tokens": token_rows, "chunks": chunks})
        for chunk in chunks:
            positions, candidates, token_indices = [], [], []
            for index, position in zip(chunk["token_indices"], chunk["first_positions"]):
                options = action_model["candidatesByTrigger"].get(language+"|"+tokens[index][0])
                if options:
                    token_indices.append(index)
                    positions.append(position)
                    candidates.append([0]+options)
            if not positions:
                continue
            example = {"input_ids": chunk["input_ids"], "positions": positions, "candidates": candidates,
                       "targets": [0]*len(positions)}
            inputs, _ = collate([example], tokenizer.pad, torch)
            with torch.no_grad():
                logits = net(*inputs).tolist()
            probes.append({"language": language, "text": text, "tokenIndices": token_indices,
                           "inputs": {key: value.tolist() for key, value in zip(
                               ["input_ids", "attention_mask", "word_positions", "candidate_ids", "candidate_mask"], inputs)},
                           "logitsFloat32": logits})
    return {"format": "localcorrect-context-encoder-parity-v1", "modelSha256": model_sha,
            "provenance": "Fixed synthetic arithmetic contexts; no learner text or correction-quality gold.",
            "absoluteTolerance": 0.0001, "tokenizerProbes": tokenizer_probes, "probes": probes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--actions", type=Path, required=True)
    parser.add_argument("--pretrained", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=500)
    parser.add_argument("--keep-steps", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--seed", type=int, default=81173)
    parser.add_argument("--encoder-lr", type=float, default=0.00003)
    parser.add_argument("--head-lr", type=float, default=0.001)
    parser.add_argument("--balance-languages", action="store_true")
    parser.add_argument("--warmup-steps", type=int, default=0)
    parser.add_argument("--decay-lr", action="store_true", help="Linearly decay after warmup to 10 percent of the initial rate")
    parser.add_argument("--smoke-only", action="store_true")
    args = parser.parse_args()
    if min(args.steps, args.batch_size, args.threads) < 1 or args.keep_steps < 0 or args.warmup_steps < 0:
        parser.error("Edit steps, batch size and threads must be positive; KEEP/warmup steps nonnegative")
    import torch
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(args.seed)
    rng = random.Random(args.seed)
    started = time.monotonic()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    action_model = json.loads(args.actions.read_text())
    rows, hashes, split_counts = BASE.read_train([args.input])
    if set(split_counts) != {"train"}:
        raise ValueError("Input must contain training rows only")
    if list(hashes.values()) != list(action_model["training"]["trainDataSha256"].values()):
        raise ValueError("Training corpus differs from the frozen action vocabulary corpus")
    parsed, action_ids = verified_actions(action_model, rows)
    pretrained_manifest = json.loads((args.pretrained / "manifest.json").read_text())
    for name in ("config.json", "model.safetensors", "vocab.txt"):
        if sha256(args.pretrained / name) != pretrained_manifest["files"][name]["sha256"]:
            raise ValueError("Pretrained file differs from pinned manifest: " + name)
    tokenizer = PortableWordPiece(args.pretrained / "vocab.txt")
    examples, positives, negatives, data_counts = prepare_examples(parsed, action_model, action_ids, tokenizer)
    balanced_pools = []
    for pool in (positives, negatives):
        groups = defaultdict(list)
        for index in pool:
            groups[examples[index]["language"]].append(index)
        balanced_pools.append(groups)
    if args.balance_languages:
        for pool in (positives, negatives):
            if {examples[i]["language"] for i in pool} != {row["language"] for row in rows}:
                raise ValueError("Each training language needs edit and KEEP-only chunks for balanced batches")
    net = build_network(args.pretrained, len(action_model["actions"]), torch)
    optimizer = torch.optim.AdamW([{"params": net.encoder.parameters(), "lr": args.encoder_lr},
                                  {"params": net.head.parameters(), "lr": args.head_lr}], weight_decay=0.01)
    loss_history = []
    training_started = time.monotonic()
    net.train()
    steps = 5 if args.smoke_only else args.steps + args.keep_steps
    sampled_languages = Counter()
    for step in range(steps):
        keep_phase = step >= args.steps
        positive_count = max(1, args.batch_size // (4 if keep_phase else 2))
        if args.balance_languages:
            indices = language_balanced_indices(balanced_pools, positive_count, args.batch_size, step, rng)
        else:
            indices = rng.choices(positives, k=positive_count) + rng.choices(negatives, k=args.batch_size-positive_count)
        sampled_languages.update(examples[i]["language"] for i in indices)
        multiplier = min(1.0, (step+1)/max(1, args.warmup_steps))
        if args.decay_lr and step >= args.warmup_steps:
            multiplier = max(0.1, 1.0-0.9*(step-args.warmup_steps)/max(1, steps-args.warmup_steps-1))
        for group, initial_rate in zip(optimizer.param_groups, (args.encoder_lr, args.head_lr)):
            group["lr"] = initial_rate*multiplier
        inputs, targets = collate([examples[i] for i in indices], tokenizer.pad, torch)
        optimizer.zero_grad(set_to_none=True)
        logits = net(*inputs)
        per_word_loss = torch.nn.functional.cross_entropy(logits.flatten(0, 1), targets.flatten(),
                                                         ignore_index=-100, reduction="none").reshape(targets.shape)
        word_weights = torch.where(targets > 0, 1.0 if keep_phase else 3.0, 2.0 if keep_phase else 1.0)
        word_weights = word_weights * (targets != -100)
        # Average each sentence chunk before the batch. Long German chunks must
        # not undo explicit language balancing through a larger word count.
        loss = ((per_word_loss*word_weights).sum(dim=1)/word_weights.sum(dim=1).clamp(min=1)).mean()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        optimizer.step()
        if step == 0 or (step+1) % 25 == 0 or step+1 == steps:
            point = {"step": step+1, "phase": "keep" if keep_phase else "edit",
                     "crossEntropy": float(loss.detach()), "elapsedSeconds": time.monotonic()-training_started,
                     "peakRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
            point["learningRateMultiplier"] = multiplier
            loss_history.append(point)
            print(json.dumps(point), flush=True)
    net.eval()
    report = {"format": FORMAT, "seed": args.seed, "steps": steps, "editSteps": args.steps,
              "keepSteps": args.keep_steps, "batchSize": args.batch_size, "threads": args.threads,
              "encoderLearningRate": args.encoder_lr, "headLearningRate": args.head_lr,
              "languageBalancedBatches": args.balance_languages, "sampledChunksByLanguage": dict(sampled_languages),
              "warmupSteps": args.warmup_steps, "linearLearningRateDecay": args.decay_lr,
              "trainDataSha256": hashes, "actionModelSha256": sha256(args.actions),
              "pretrainedSafetensorsSha256": sha256(args.pretrained / "model.safetensors"),
              "pretrainedFilesSha256": {name: sha256(args.pretrained / name)
                                        for name in ("config.json", "model.safetensors", "vocab.txt", "manifest.json")},
              "pretrainedRepository": pretrained_manifest["repo"], "pretrainedRevision": pretrained_manifest["revision"],
              "trainingScriptsSha256": {path.name: sha256(path) for path in (Path(__file__), Path(BASE.__file__))},
              "torchVersion": torch.__version__,
              "vocabSha256": sha256(args.pretrained / "vocab.txt"), "trainRows": len(rows),
              "trainDocumentCount": len({(row["source"], row["document_id"]) for row in rows}),
              "examples": dict(data_counts), "chunks": len(examples), "positiveChunks": len(positives),
              "keepOnlyChunks": len(negatives), "actionCountIncludingKeep": len(action_model["actions"]),
              "actionsByLanguage": dict(Counter(action["language"] for action in action_model["actions"][1:])),
              "trainingSeconds": time.monotonic()-training_started,
              "peakTrainingRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              "lossHistory": loss_history, "calibrationOrTestUsed": False,
              "thresholdCalibrated": False, "smokeOnly": args.smoke_only}
    if args.smoke_only:
        report["totalSeconds"] = time.monotonic()-started
        (args.output_dir / "smoke-report.json").write_text(json.dumps(report, indent=2)+"\n")
        print(json.dumps({"smoke": "pass", "seconds": report["totalSeconds"],
                          "peakRssKiB": report["peakTrainingRssKiB"]}), flush=True)
        return
    from safetensors.torch import save_file
    save_file({key: value.detach().contiguous() for key, value in net.state_dict().items()},
              str(args.output_dir / "encoder-head.safetensors"))
    # Standard operator fp32 ONNX, sparse outputs only. Dynamic batch, sequence,
    # and selected word dimensions; the nine candidate slots remain fixed.
    export_inputs, _ = collate([examples[positives[0]], examples[negatives[0]]], tokenizer.pad, torch)
    names = ["input_ids", "attention_mask", "word_positions", "candidate_ids", "candidate_mask"]
    dynamic = {"input_ids": {0: "batch", 1: "sequence"}, "attention_mask": {0: "batch", 1: "sequence"},
               "word_positions": {0: "batch", 1: "words"}, "candidate_ids": {0: "batch", 1: "words"},
               "candidate_mask": {0: "batch", 1: "words"}, "logits": {0: "batch", 1: "words"}}
    model_path = args.output_dir / "context-encoder.onnx"
    with torch.no_grad():
        torch.onnx.export(net, export_inputs, str(model_path), input_names=names, output_names=["logits"],
                          dynamic_axes=dynamic, opset_version=17, do_constant_folding=True, dynamo=False)
    model_sha = sha256(model_path)
    parity = export_parity(net, tokenizer, action_model, model_sha, torch)
    (args.output_dir / "parity.json").write_text(json.dumps(parity, ensure_ascii=False, separators=(",", ":"))+"\n")
    metadata = {"format": FORMAT, "modelSha256": model_sha, "modelBytes": model_path.stat().st_size,
                "vocabSha256": report["vocabSha256"], "vocab": tokenizer.words,
                "actions": action_model["actions"], "candidatesByTrigger": action_model["candidatesByTrigger"],
                "tokenizer": {"tokenRegex": BASE.JS_TOKEN_PATTERN, "wordRegex": BASE.WORD.pattern[:-2]+"$",
                              "doLowerCase": False, "stripAccents": False,
                              "apostropheSplit": ["'", "’"], "maxWordPieceCharacters": 100,
                              "maximumSequenceLength": MAX_LENGTH, "sentenceEndingTokens": [".", "!", "?"],
                              "newlineEndsChunk": True, "candidateWidth": CANDIDATE_WIDTH,
                              "padId": tokenizer.pad, "unkId": tokenizer.unk,
                              "clsId": tokenizer.cls, "sepId": tokenizer.sep},
                "training": report,
                "limitations": ["Single-word REPLACE actions only; unsupported gold edits are masked.",
                                "Context stops at sentence/newline boundaries or 128 WordPieces.",
                                "Scores require independent calibration before correction use."]}
    (args.output_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))+"\n")
    report.update({"modelSha256": model_sha, "modelBytes": model_path.stat().st_size,
                   "checkpointSha256": sha256(args.output_dir / "encoder-head.safetensors"),
                   "paritySha256": sha256(args.output_dir / "parity.json"),
                   "totalSeconds": time.monotonic()-started})
    (args.output_dir / "training-report.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps({"modelSha256": model_sha, "modelBytes": report["modelBytes"],
                      "seconds": report["totalSeconds"], "peakTrainingRssKiB": report["peakTrainingRssKiB"]}), flush=True)


if __name__ == "__main__":
    main()
