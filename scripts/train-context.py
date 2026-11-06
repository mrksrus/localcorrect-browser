#!/usr/bin/env python3
"""Mine actions or train a small offline classifier from parallel train data.

Only split=train is read for action mining and optimization. This script does
not choose acceptance thresholds or evaluate calibration/test correction quality.
See the exported model's featureSpec for portable JS/.NET48 Jint inference.
"""
import argparse
from collections import Counter, defaultdict
import difflib
import hashlib
import json
import math
from pathlib import Path
import random
import re
import time

LETTERS = r"A-Za-zÀ-ÖØ-öø-ÿĀ-ž"
WORD = re.compile(r"[" + LETTERS + r"]+(?:['’][" + LETTERS + r"]+)*\Z")
EDIT_WORD = re.compile(r"[" + LETTERS + r"]+\Z")
JS_TOKEN_PATTERN = r"[" + LETTERS + r"]+(?:['’][" + LETTERS + r"]+)*|[^\s]"
# Python's \s includes U+0085/U+001C..001F and omits FEFF, unlike ECMAScript.
JS_WHITESPACE = r"\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
TOKEN = re.compile(r"[" + LETTERS + r"]+(?:['’][" + LETTERS + r"]+)*|[^" + JS_WHITESPACE + "]")
UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜẞ"
LOWER = "abcdefghijklmnopqrstuvwxyzäöüß"
FOLD = str.maketrans(UPPER, LOWER)
BUCKETS, DIM, RADIUS, HIDDEN = 8192, 8, 3, 64
FUNCTIONAL_FAMILIES = ({"am", "is", "are", "was", "were", "be", "been", "being"},
                       {"has", "have", "had"}, {"do", "does", "did"},
                       {"bin", "bist", "ist", "sind", "seid", "war", "waren"},
                       {"habe", "hast", "hat", "haben", "habt", "hatte", "hatten"})


def tokenize(text):
    """Codepoint spans internally; exported span probes use UTF16 offsets."""
    return [(m.group(), m.start(), m.end()) for m in TOKEN.finditer(text)]


def fold(word):
    return word.translate(FOLD)


def eligible_replacement(original, replacement):
    if not EDIT_WORD.fullmatch(original) or not EDIT_WORD.fullmatch(replacement):
        return False
    a, b = fold(original), fold(replacement)
    if any(a in family and b in family for family in FUNCTIONAL_FAMILIES):
        return True
    if abs(len(a)-len(b)) > 2:
        return False
    previous = list(range(len(b)+1))
    for i, char_a in enumerate(a, 1):
        current = [i]
        for j, char_b in enumerate(b, 1):
            current.append(min(current[-1]+1, previous[j]+1, previous[j-1]+(char_a != char_b)))
        previous = current
    return previous[-1] <= 2


def bucket(word, language):
    value = 2166136261
    data = (language + "|" + fold(word)).encode("utf-16-le", "surrogatepass")
    for i in range(0, len(data), 2):
        value = ((value ^ (data[i] | data[i + 1] << 8)) * 16777619) & 0xFFFFFFFF
    return 2 + value % (BUCKETS - 2)


def scalars(word):
    cases = [1 if c in UPPER else 0 for c in word if c in UPPER or c in LOWER]
    return [int(bool(WORD.fullmatch(word))),
            int(bool(cases) and cases[0] == 1 and not any(cases[1:])),
            int(bool(cases) and all(cases)),
            int(bool(cases) and not any(cases))]


def window(tokens, index, language):
    ids, flags = [], []
    for pos in range(index - RADIUS, index + RADIUS + 1):
        if pos < 0 or pos >= len(tokens):
            ids.append(0 if pos < 0 else 1)
            flags.append([0, 0, 0, 0])
        else:
            ids.append(bucket(tokens[pos], language))
            flags.append(scalars(tokens[pos]))
    return ids, flags, [int(language == "en"), int(language == "de")]


def aligned(row):
    """Return token labels as action keys, None for unsupported edit positions.

    Equal tokens start as KEEP. A nonrepresentable edit masks every affected
    source token plus the preceding/following anchor. Gap-only changes mask the
    adjacent tokens. Other supported edits in the sentence remain trainable.
    """
    original, target = row["input"], row["expected"]
    src, dst = tokenize(original), tokenize(target)
    a, b = [x[0] for x in src], [x[0] for x in dst]
    labels = [0] * len(a)
    operations = difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
    mapping, edited = {}, set()
    for tag, i, j, k, l in operations:
        if tag == "equal":
            mapping.update(zip(range(i, j), range(k, l)))
            continue
        key = None
        if tag == "replace" and j-i == l-k == 1 and eligible_replacement(a[i], b[k]):
            key = (row["language"], a[i], "REPLACE", b[k])
            labels[i] = key
            edited.add(i)
        if key is None:
            for pos in range(max(0, i-1), min(len(a), max(j, i+1)+1)):
                labels[pos] = None
    # Equal adjacent tokens can still conceal unsupported whitespace changes.
    for i in range(len(a)-1):
        if i in mapping and i+1 in mapping and mapping[i+1] == mapping[i]+1:
            k = mapping[i]
            if original[src[i][2]:src[i+1][1]] != target[dst[k][2]:dst[k+1][1]]:
                if i not in edited:
                    labels[i] = None
                if i+1 not in edited:
                    labels[i+1] = None
    if src and dst:
        if original[:src[0][1]] != target[:dst[0][1]] and 0 not in edited:
            labels[0] = None
        if original[src[-1][2]:] != target[dst[-1][2]:] and len(src)-1 not in edited:
            labels[-1] = None
    return a, labels


def read_train(paths):
    rows, all_ids, train_ids, other_ids = [], set(), set(), set()
    hashes, split_counts = {}, Counter()
    for path_index, path in enumerate(paths):
        raw = path.read_bytes()
        hashes[str(path_index) + ":" + path.name] = hashlib.sha256(raw).hexdigest()
        for line_number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            split_counts[row["split"]] += 1
            doc = (row["source"], row["document_id"])
            if row["split"] != "train":
                other_ids.add(doc)
                continue
            if row["id"] in all_ids:
                raise ValueError("Duplicate training id: " + row["id"])
            all_ids.add(row["id"])
            if row["language"] not in ("en", "de"):
                raise ValueError("Unsupported training language")
            train_ids.add(doc)
            rows.append(row)
    if train_ids & other_ids:
        raise ValueError("Document leakage between train and another split")
    if not rows:
        raise ValueError("No split=train rows")
    return rows, hashes, split_counts


def mine_actions(counts, min_count, max_actions, max_per_trigger, balance_languages=False):
    """Freeze deterministic train-only candidates, optionally sharing language slots."""
    eligible = [(key, count) for key, count in sorted(counts.items(), key=lambda x: (-x[1], x[0]))
                if count >= min_count]
    if balance_languages:
        groups = {language: [item for item in eligible if item[0][0] == language]
                  for language in sorted({key[0] for key, _ in eligible})}
        # Apply each trigger's cap before interleaving, so exhausted/ambiguous
        # triggers cannot consume another language's turn.
        for language, items in groups.items():
            seen = Counter()
            retained = []
            for key, count in items:
                if seen[key[:2]] < max_per_trigger:
                    retained.append((key, count))
                    seen[key[:2]] += 1
            groups[language] = retained
        eligible = [groups[language][index] for index in range(max(map(len, groups.values()), default=0))
                    for language in sorted(groups) if index < len(groups[language])]
    selected, by_trigger = [], defaultdict(list)
    for key, _ in eligible:
        trigger = key[0] + "|" + key[1]
        if len(selected) >= max_actions:
            break
        if len(by_trigger[trigger]) >= max_per_trigger:
            continue
        selected.append(key)
        by_trigger[trigger].append(len(selected))
    return selected, dict(by_trigger)


def export_reference(model, tokens, index, language, row_ids, torch):
    ids, flags, language_flags = window(tokens, index, language)
    weights = model["weights"]
    features = []
    for token_id, token_flags in zip(ids, flags):
        features.extend(weights["embedding"][token_id])
        features.extend(token_flags)
    features.extend(language_flags)
    hidden = []
    for weight, bias in zip(weights["hiddenWeight"], weights["hiddenBias"]):
        value = bias
        for x, w in zip(features, weight):
            value += x*w
        hidden.append(math.tanh(value))
    logits = []
    for row_id in row_ids:
        value = weights["outputBias"][row_id]
        for x, w in zip(hidden, weights["outputWeight"][row_id]):
            value += x*w
        logits.append(value)
    feature_tensor = torch.tensor(features, dtype=torch.float32)
    hidden32 = torch.tanh(torch.nn.functional.linear(
        feature_tensor, torch.tensor(weights["hiddenWeight"]), torch.tensor(weights["hiddenBias"])))
    logits32 = torch.nn.functional.linear(hidden32,
        torch.tensor([weights["outputWeight"][i] for i in row_ids]),
        torch.tensor([weights["outputBias"][i] for i in row_ids])).tolist()
    return {"language": language, "tokens": tokens, "tokenIndex": index,
            "candidateRowIds": row_ids, "bucketIds": ids, "slotScalars": flags,
            "inputFeatures": features, "hidden": hidden,
            "logitsDouble": logits, "logitsFloat32": logits32}


def export_synthetic_parity(model, model_sha, torch):
    """Fixed arithmetic contexts, independent of learner text and quality gold."""
    cases = [
        ("en", "i placed the amber cube beside the lamp.", "i"),
        ("en", "The note says i will arrive later.", "i"),
        ("en", "I placed the amber cube beside the lamp.", "I"),
        ("en", "The brass clock is beside the blue jar.", "is"),
        ("en", "The brass clocks are beside the blue jars.", "are"),
        ("en", "We found the copper key near the bowl.", "the"),
        ("en", "Please put this card inside the green box.", "this"),
        ("en", "The artist has a silver brush.", "has"),
        ("en", "The artists have a silver brush.", "have"),
        ("en", "i", "i"),
        ("en", "Near the gate waits this", "this"),
        ("en", "The sign reads 'i', followed by a star.", "i"),
        ("de", "Heute steht die kleine Vase neben dem Fenster.", "die"),
        ("de", "Neben der Lampe liegt ein grünes Heft.", "der"),
        ("de", "Wir stellen das runde Glas auf den Tisch.", "das"),
        ("de", "Sie findet den roten Würfel unter dem Stuhl.", "den"),
        ("de", "Auf dem Regal steht eine gelbe Schale.", "dem"),
        ("de", "Die blaue Kiste ist unter dem Tisch.", "ist"),
        ("de", "Die blauen Kisten sind unter dem Tisch.", "sind"),
        ("de", "Dort wartet ein kleiner Roboter am Tor.", "ein"),
        ("de", "Dort wartet eine kleine Maschine am Tor.", "eine"),
        ("de", "Die Kinder haben einen violetten Ball.", "haben"),
        ("de", "Das Kind hat einen violetten Ball.", "hat"),
        ("de", "ich", "ich"),
    ]
    probes = []
    for language, text, trigger in cases:
        tokens = [x[0] for x in tokenize(text)]
        row_ids = [0] + model["candidatesByTrigger"].get(language + "|" + trigger, [])
        probes.append(export_reference(model, tokens, tokens.index(trigger), language, row_ids, torch))
    edge_texts = ["Ärger ÖL süß ẞ ß it's O’Neil, 🚀!", "A a 7.\n\tEnd", "İstanbul Straße aé",
                  "a\ufeffb\u0085c\u001cd\u00a0e\u2028f"]
    token_probes = []
    for text in edge_texts:
        values = []
        for token, start, end in tokenize(text):
            values.append({"text": token, "start": len(text[:start].encode("utf-16-le"))//2,
                           "end": len(text[:end].encode("utf-16-le"))//2,
                           "folded": fold(token), "scalars": scalars(token),
                           "hashEn": bucket(token, "en"), "hashDe": bucket(token, "de")})
        token_probes.append({"text": text, "tokens": values})
    return {"format": "localcorrect-context-parity-v1", "modelSha256": model_sha,
            "provenance": "Fixed synthetic EN/DE arithmetic contexts; no learner text or correction-quality gold.",
            "absoluteTolerance": 0.00005, "tokenizerProbes": token_probes, "probes": probes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--parity", type=Path)
    parser.add_argument("--mine-only", action="store_true", help="Export train-only actions without fitting the scratch MLP")
    parser.add_argument("--balance-languages", action="store_true", help="Share bounded action slots between languages")
    parser.add_argument("--steps", type=int, default=1000)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--min-count", type=int, default=2)
    parser.add_argument("--max-actions", type=int, default=1200)
    parser.add_argument("--max-per-trigger", type=int, default=8)
    parser.add_argument("--seed", type=int, default=73109)
    parser.add_argument("--learning-rate", type=float, default=0.002)
    args = parser.parse_args()
    if not args.mine_only and args.parity is None:
        parser.error("--parity is required unless --mine-only is used")
    if min(args.min_count, args.max_actions, args.max_per_trigger, args.batch_size, args.threads) < 1:
        parser.error("Counts, bounds, batch size and threads must be positive")
    random.seed(args.seed)
    started = time.monotonic()
    rows, data_hashes, split_counts = read_train(args.input)
    if args.mine_only and set(split_counts) != {"train"}:
        raise ValueError("Action mining requires an input file containing training rows only")
    parsed = [(row, *aligned(row)) for row in rows]
    alignment_stats = Counter()
    for row, tokens, labels in parsed:
        target = [x[0] for x in tokenize(row["expected"])]
        for tag, i, j, k, l in difflib.SequenceMatcher(None, tokens, target, autojunk=False).get_opcodes():
            if tag == "equal":
                continue
            alignment_stats["goldTokenEditHunks"] += 1
            alignment_stats["gold" + tag.title() + "Hunks"] += 1
            if tag == "replace" and j-i == l-k == 1 and eligible_replacement(tokens[i], target[k]):
                alignment_stats["eligibleSingleWordReplacementHunks"] += 1
                if fold(tokens[i]) == fold(target[k]):
                    alignment_stats["eligibleCaseOnlyHunks"] += 1
            else:
                alignment_stats["unsupportedHunks"] += 1
    counts = Counter(label for _, _, labels in parsed for label in labels if isinstance(label, tuple))
    selected, by_trigger = mine_actions(counts, args.min_count, args.max_actions,
                                      args.max_per_trigger, args.balance_languages)
    if not selected:
        raise ValueError("No supported actions meet mining frequency")
    action_ids = {key: i+1 for i, key in enumerate(selected)}
    actions = [{"kind": "KEEP", "trainCount": 0}]
    for key in selected:
        language, trigger, kind, replacement = key
        actions.append({"kind": kind, "language": language, "trigger": trigger,
                        "replacement": replacement, "trainCount": counts[key]})
    if args.mine_only:
        training = {"minCount": args.min_count, "maxActions": args.max_actions,
                    "maxPerTrigger": args.max_per_trigger, "balanceLanguages": args.balance_languages,
                    "trainDataSha256": data_hashes, "trainRows": len(rows),
                    "miningScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    "calibrationOrTestUsed": False, "thresholdCalibrated": False}
        model = {"format": "localcorrect-context-actions-v1", "actions": actions,
                 "candidatesByTrigger": by_trigger, "training": training}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":"))+"\n")
        report = {"actionModelSha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
                  "actionCountIncludingKeep": len(actions), "training": training,
                  "actionsByLanguage": dict(Counter(key[0] for key in selected)),
                  "actionSupportByLanguage": dict(Counter({language: sum(counts[key] for key in selected if key[0] == language)
                                                           for language in sorted({key[0] for key in selected})})),
                  "trainGoldAlignmentStats": dict(alignment_stats),
                  "seconds": time.monotonic()-started, "calibrationOrTestUsed": False}
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2)+"\n")
        print(json.dumps(report), flush=True)
        return
    import torch
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    # Each example competes with KEEP and every mined action for its exact word.
    examples, positives, negatives, stats = [], [], [], Counter()

    def add(tokens, labels, language, control=False):
        for index, (token, label) in enumerate(zip(tokens, labels)):
            if not WORD.fullmatch(token):
                continue
            candidates = by_trigger.get(language + "|" + token, [])
            if not candidates:
                continue
            if label is None or isinstance(label, tuple) and label not in action_ids:
                stats["maskedUnsupportedOrUnmined"] += 1
                continue
            target = action_ids[label] if isinstance(label, tuple) else 0
            candidate_rows = [0] + candidates
            ids, flags, lang = window(tokens, index, language)
            item = (ids, flags, lang, candidate_rows, candidate_rows.index(target))
            example_index = len(examples)
            examples.append(item)
            (positives if target else negatives).append(example_index)
            stats["positive" if target else "correctedIdentityKeep" if control else "originalKeep"] += 1
    for row, tokens, labels in parsed:
        add(tokens, labels, row["language"])
        corrected = [x[0] for x in tokenize(row["expected"])]
        add(corrected, [0] * len(corrected), row["language"], control=True)
    if not positives or not negatives:
        raise ValueError("Training needs both supported edits and candidateable KEEP controls")
    width = 1 + args.max_per_trigger
    def tensor_batch(indices):
        batch = [examples[i] for i in indices]
        ids = torch.tensor([x[0] for x in batch], dtype=torch.long)
        flags = torch.tensor([x[1] for x in batch], dtype=torch.float32)
        langs = torch.tensor([x[2] for x in batch], dtype=torch.float32)
        candidates = torch.tensor([x[3] + [0] * (width-len(x[3])) for x in batch], dtype=torch.long)
        mask = torch.tensor([[True]*len(x[3]) + [False]*(width-len(x[3])) for x in batch])
        labels = torch.tensor([x[4] for x in batch], dtype=torch.long)
        return ids, flags, langs, candidates, mask, labels
    class Network(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.embedding = torch.nn.Embedding(BUCKETS, DIM)
            torch.nn.init.normal_(self.embedding.weight, std=0.15)
            self.hidden = torch.nn.Linear((RADIUS*2+1)*(DIM+4)+2, HIDDEN)
            self.output = torch.nn.Linear(HIDDEN, len(actions))
        def forward(self, ids, flags, langs, candidates, mask):
            features = torch.cat([self.embedding(ids), flags], dim=2).flatten(1)
            hidden = torch.tanh(self.hidden(torch.cat([features, langs], dim=1)))
            selected_w = self.output.weight[candidates]
            logits = (hidden[:, None, :] * selected_w).sum(dim=2) + self.output.bias[candidates]
            return logits.masked_fill(~mask, -1e9)
    net = Network()
    optimizer = torch.optim.AdamW(net.parameters(), lr=args.learning_rate, weight_decay=0.0001)
    losses = []
    # Balanced supervision ensures rare edits receive gradients while actual KEEP
    # prevalence is restored through independent calibration, not guessed here.
    positive_count = args.batch_size // 2
    net.train()
    for step in range(args.steps):
        indices = random.choices(positives, k=positive_count) + random.choices(negatives, k=args.batch_size-positive_count)
        ids, flags, langs, candidates, mask, labels = tensor_batch(indices)
        optimizer.zero_grad(set_to_none=True)
        loss = torch.nn.functional.cross_entropy(net(ids, flags, langs, candidates, mask), labels)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
        optimizer.step()
        if step == 0 or (step+1) % 100 == 0 or step+1 == args.steps:
            point = {"step": step+1, "crossEntropy": float(loss.detach())}
            losses.append(point)
            print(json.dumps(point), flush=True)
    net.eval()
    weights = {"embedding": net.embedding.weight.detach().tolist(),
               "hiddenWeight": net.hidden.weight.detach().tolist(),
               "hiddenBias": net.hidden.bias.detach().tolist(),
               "outputWeight": net.output.weight.detach().tolist(),
               "outputBias": net.output.bias.detach().tolist()}
    feature_spec = {"tokenRegex": JS_TOKEN_PATTERN, "wordRegex": WORD.pattern[:-2] + "$",
                    "foldUpper": UPPER, "foldLower": LOWER, "hash": "fnv1a-utf16",
                    "buckets": BUCKETS, "embeddingDim": DIM, "radius": RADIUS,
                    "slotScalars": ["isWord", "isTitle", "isUpper", "isLower"],
                    "languageScalars": ["en", "de"], "hiddenSize": HIDDEN,
                    "inputSize": (RADIUS*2+1)*(DIM+4)+2, "activation": "tanh"}
    model = {"format": "localcorrect-context-edit-v1", "featureSpec": feature_spec,
             "actions": actions, "candidatesByTrigger": dict(by_trigger), "weights": weights,
             "training": {"seed": args.seed, "steps": args.steps, "batchSize": args.batch_size,
                          "learningRate": args.learning_rate, "minCount": args.min_count,
                          "maxActions": args.max_actions, "maxPerTrigger": args.max_per_trigger,
                          "balanceLanguages": args.balance_languages,
                          "actionEligibility": "Latin REPLACE restricted-fold Levenshtein<=2 or listed auxiliary-verb family",
                          "functionalFamilies": [sorted(x) for x in FUNCTIONAL_FAMILIES],
                          "trainDataSha256": data_hashes, "trainRows": len(rows),
                          "weightsSha256": hashlib.sha256(json.dumps(weights, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                          "thresholdCalibrated": False}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")) + "\n")
    sha = hashlib.sha256(args.output.read_bytes()).hexdigest()
    parity = export_synthetic_parity(model, sha, torch)
    args.parity.parent.mkdir(parents=True, exist_ok=True)
    args.parity.write_text(json.dumps(parity, ensure_ascii=False, separators=(",", ":")) + "\n")
    report = {"modelSha256": sha, "modelBytes": args.output.stat().st_size,
              "seconds": time.monotonic()-started, "torchVersion": torch.__version__,
              "threads": args.threads, "training": model["training"],
              "providedSplitRows": dict(split_counts), "trainActionKinds": dict(Counter(x[2] for x in selected)),
              "actionCountIncludingKeep": len(actions), "examples": dict(stats),
              "trainGoldAlignmentStats": dict(alignment_stats),
              "uniqueTrainDocuments": len({(r["source"], r["document_id"]) for r in rows}),
              "lossHistory": losses, "calibrationOrTestUsed": False,
              "limitations": ["Seven-token local context; no sentence-level representation.",
                              "Exact surface REPLACE triggers mined from training only; insertions, deletions, multiword and non-Latin edits are unsupported and masked.",
                              "Balanced loss scores require separate threshold calibration."]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"modelSha256": sha, "modelBytes": report["modelBytes"],
                      "examples": dict(stats), "seconds": report["seconds"]}), flush=True)


if __name__ == "__main__":
    main()
