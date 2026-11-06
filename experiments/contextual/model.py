"""Local masked-token research model. Not an automatic grammar corrector.

hmBERT was trained on historic newspapers. Its spelling priors need modern-text
validation. ORTScorer deliberately imports neither torch nor transformers.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import random
import shutil
import time
import tempfile

BASE_REVISION = "4a0964c747fd6c06a20e8c0ca32bc27a23a6ad34"


def file_hash(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def configure_torch(seed=20261106):
    import torch
    torch.set_num_threads(2)
    try:
        torch.set_num_interop_threads(2)
    except RuntimeError:
        pass  # PyTorch allows this setting only before its first parallel work.
    random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)
    return torch


def load_local(model_dir):
    """Load only local safe weights, checking the pretrained MLM head exists."""
    from transformers import AutoTokenizer, BertForMaskedLM
    model_dir = Path(model_dir).resolve(strict=True)
    if not (model_dir / "model.safetensors").is_file():
        raise ValueError("A local model.safetensors is required; pickle fallback is forbidden")
    tokenizer = AutoTokenizer.from_pretrained(
        str(model_dir), local_files_only=True, trust_remote_code=False,
        do_lower_case=False, strip_accents=False,
    )
    model, loading = BertForMaskedLM.from_pretrained(
        str(model_dir), local_files_only=True, trust_remote_code=False,
        use_safetensors=True, output_loading_info=True, attn_implementation="eager",
    )
    missing = loading.get("missing_keys", [])
    mismatched = loading.get("mismatched_keys", [])
    if missing or mismatched:
        raise ValueError(f"Incomplete pretrained model: missing={missing}, mismatched={mismatched}")
    if tokenizer.do_lower_case:
        raise ValueError("This experiment requires the cased tokenizer")
    model.eval()
    loading = {key: sorted(value) if isinstance(value, set) else value
               for key, value in loading.items()}
    return tokenizer, model, loading


def selected_wrapper(model):
    """Apply the trained MLM head to one selected hidden row per example."""
    import torch

    class SelectedMaskedLM(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.model = model

        def forward(self, input_ids, attention_mask, positions):
            hidden = self.model.bert(
                input_ids=input_ids, attention_mask=attention_mask,
                return_dict=False,
            )[0]
            index = positions.reshape(-1, 1, 1).expand(-1, 1, hidden.shape[-1])
            selected = torch.gather(hidden, 1, index).squeeze(1)
            return self.model.cls(selected)

    return SelectedMaskedLM()


def padded_arrays(input_ids, positions, attention_mask=None, pad_id=0):
    import numpy as np
    rows = [list(row) for row in input_ids]
    if not rows or any(not row for row in rows):
        raise ValueError("Expected a nonempty batch of nonempty token sequences")
    positions = np.asarray(positions, dtype=np.int64)
    if positions.shape != (len(rows),):
        raise ValueError("Exactly one target position is required per sequence")
    width = max(map(len, rows))
    ids = np.full((len(rows), width), pad_id, dtype=np.int64)
    masks = np.zeros_like(ids)
    supplied = None if attention_mask is None else [list(row) for row in attention_mask]
    if supplied is not None and len(supplied) != len(rows):
        raise ValueError("Attention-mask batch length mismatch")
    for i, row in enumerate(rows):
        if not 0 <= positions[i] < len(row):
            raise ValueError("Target position lies outside its sequence")
        ids[i, :len(row)] = row
        if supplied is None:
            masks[i, :len(row)] = 1
        else:
            if len(supplied[i]) != len(row) or any(x not in (0, 1) for x in supplied[i]):
                raise ValueError("Attention masks must have matching shape and binary values")
            masks[i, :len(row)] = supplied[i]
        if masks[i, positions[i]] != 1:
            raise ValueError("Target position must not be padding")
    return ids, masks, positions


class ORTScorer:
    """CPU-only inference. Importing/using this class does not import torch."""
    def __init__(self, model_path, threads=2, pad_id=0):
        import onnxruntime as ort
        if threads != 2:
            raise ValueError("This bounded experiment uses exactly two CPU threads")
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = threads
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(
            str(model_path), sess_options=options, providers=["CPUExecutionProvider"]
        )
        self.pad_id = pad_id

    def score(self, input_ids, positions, attention_mask=None):
        ids, masks, positions = padded_arrays(input_ids, positions, attention_mask, self.pad_id)
        return self.session.run(["logits"], {
            "input_ids": ids, "attention_mask": masks, "positions": positions,
        })[0]


def default_validation(tokenizer):
    texts = [
        "Please send the [MASK] tomorrow.", "The cat sat on the [MASK].",
        "We will meet at the [MASK].", "Thank you for your [MASK].",
        "Bitte sende die [MASK] morgen.", "Die Katze sitzt auf dem [MASK].",
        "Wir treffen uns am [MASK].", "Vielen Dank für deine [MASK].",
    ]
    result = []
    for text in texts:
        ids = tokenizer.encode(text, add_special_tokens=True)
        result.append({"input_ids": ids, "position": ids.index(tokenizer.mask_token_id)})
    return result


def read_examples(path, tokenizer, require_target=False):
    result = []
    with open(path, encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            item = json.loads(line)
            ids, position = item["input_ids"], item["position"]
            if (not isinstance(ids, list) or not ids or len(ids) > 512
                or any(type(x) is not int or not 0 <= x < len(tokenizer) for x in ids)
                or type(position) is not int or not 0 <= position < len(ids)):
                raise ValueError(f"Invalid tokenized example at line {line_number}")
            if ids[position] != tokenizer.mask_token_id:
                raise ValueError(f"Target is not [MASK] at line {line_number}")
            if require_target and (type(item.get("target_id")) is not int
                                   or not 0 <= item["target_id"] < len(tokenizer)):
                raise ValueError(f"Invalid target_id at line {line_number}")
            result.append(item)
    if not result:
        raise ValueError("Example file is empty")
    return result


def numerical_comparison(reference, actual):
    import numpy as np
    ref_order = np.argsort(reference, axis=1)
    actual_order = np.argsort(actual, axis=1)
    rows = np.arange(len(reference))
    top, second = ref_order[:, -1], ref_order[:, -2]
    ref_margin = reference[rows, top] - reference[rows, second]
    fixed_margin = actual[rows, top] - actual[rows, second]
    return {
        "max_abs_logit_error": float(np.max(np.abs(actual - reference))),
        "mean_abs_logit_error": float(np.mean(np.abs(actual - reference))),
        "argmax_equal": int(np.sum(top == actual_order[:, -1])),
        "examples": int(len(reference)),
        "reference_argmax_ids": top.tolist(),
        "actual_argmax_ids": actual_order[:, -1].tolist(),
        "reference_top2_margin": ref_margin.tolist(),
        "actual_margin_for_reference_top2": fixed_margin.tolist(),
        "max_abs_margin_error": float(np.max(np.abs(fixed_margin - ref_margin))),
    }


def export_model(model_dir, output_dir, validation_jsonl=None):
    torch = configure_torch()
    tokenizer, model, loading = load_local(model_dir)
    wrapper = selected_wrapper(model).eval()
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    examples = (read_examples(validation_jsonl, tokenizer) if validation_jsonl
                else default_validation(tokenizer))
    arrays = padded_arrays([x["input_ids"] for x in examples],
                           [x["position"] for x in examples], pad_id=tokenizer.pad_token_id)
    tensors = tuple(torch.from_numpy(x) for x in arrays)
    with torch.inference_mode():
        reference = wrapper(*tensors).numpy()
    fp32_path = output_dir / "selected-mlm.fp32.onnx"
    torch.onnx.export(
        wrapper, tensors, str(fp32_path), input_names=["input_ids", "attention_mask", "positions"],
        output_names=["logits"], dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "positions": {0: "batch"}, "logits": {0: "batch"},
        }, opset_version=17, dynamo=False, external_data=False,
    )
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic
    onnx.checker.check_model(str(fp32_path))
    int8_path = output_dir / "selected-mlm.int8.onnx"
    # ORT's Gemm conversion transposes its weight initializer in place. The
    # pretrained decoder shares that initializer with the embedding Gather.
    # Give the decoder its own initializer before quantization, preserving the
    # published math and preventing corruption of the embedding matrix shape.
    quant_source = onnx.load(str(fp32_path))
    initializers = {item.name: item for item in quant_source.graph.initializer}
    gather_weights = {node.input[0] for node in quant_source.graph.node
                      if node.op_type == "Gather"}
    duplicated_weights = []
    for node in quant_source.graph.node:
        if node.op_type in ("Gemm", "MatMul") and node.input[1] in gather_weights:
            original_name = node.input[1]
            copied = onnx.TensorProto()
            copied.CopyFrom(initializers[original_name])
            copied.name = original_name + "__decoder_" + str(len(duplicated_weights))
            quant_source.graph.initializer.append(copied)
            node.input[1] = copied.name
            duplicated_weights.append(original_name)
    with tempfile.TemporaryDirectory(prefix="quantize-", dir=output_dir) as staging:
        source_path = Path(staging) / "source.onnx"
        onnx.save(quant_source, str(source_path))
        quantize_dynamic(str(source_path), str(int8_path), weight_type=QuantType.QInt8,
                         op_types_to_quantize=["MatMul", "Gemm"])
    onnx.checker.check_model(str(int8_path))
    rows, positions = [x["input_ids"] for x in examples], [x["position"] for x in examples]
    fp32 = ORTScorer(fp32_path, pad_id=tokenizer.pad_token_id).score(rows, positions)
    int8 = ORTScorer(int8_path, pad_id=tokenizer.pad_token_id).score(rows, positions)
    # Exercise dynamic axes at both a shorter batch and the pilot's 63-token
    # window length, including padding and a target near the end of the row.
    fp32_scorer = ORTScorer(fp32_path, pad_id=tokenizer.pad_token_id)
    short = fp32_scorer.score(rows[:1], positions[:1])
    long_row = [tokenizer.cls_token_id] + rows[0][1:2] * 60
    long_row += [tokenizer.mask_token_id, tokenizer.sep_token_id]
    dynamic_rows = [long_row, [tokenizer.cls_token_id, tokenizer.mask_token_id, tokenizer.sep_token_id]]
    dynamic_positions = [61, 1]
    dynamic_arrays = padded_arrays(dynamic_rows, dynamic_positions, pad_id=tokenizer.pad_token_id)
    with torch.inference_mode():
        dynamic_reference = wrapper(*(torch.from_numpy(x) for x in dynamic_arrays)).numpy()
    dynamic_actual = fp32_scorer.score(dynamic_rows, dynamic_positions)
    import numpy as np
    np.testing.assert_allclose(fp32, reference, rtol=1e-4, atol=1e-4)
    np.testing.assert_allclose(short[0], fp32[0], rtol=1e-4, atol=1e-4)
    np.testing.assert_allclose(dynamic_actual, dynamic_reference, rtol=1e-4, atol=1e-4)
    manifest = {
        "purpose": "Numerical export parity, not correction-quality validation",
        "source_model_dir": str(Path(model_dir).resolve()), "threads": 2,
        "source_safetensors_sha256": file_hash(Path(model_dir) / "model.safetensors"),
        "dynamic_shapes_checked": [[1, len(rows[0])], [2, 63]],
        "int8_adoption_status": "diagnostic artifact only; pilot uses FP32",
        "loading_info": loading,
        "quantization_duplicated_tied_weights": duplicated_weights,
        "validation_sha256": file_hash(validation_jsonl) if validation_jsonl else None,
        "validation_kind": "provided_tokenized_examples" if validation_jsonl else "eight_fixed_synthetic_masks",
        "pytorch_version": torch.__version__, "onnx_version": onnx.__version__,
        "fp32": numerical_comparison(reference, fp32),
        "int8": numerical_comparison(reference, int8),
        "artifacts": {p.name: {"sha256": file_hash(p), "bytes": p.stat().st_size}
                      for p in [fp32_path, int8_path]},
    }
    (output_dir / "export-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def train_model(model_dir, train_jsonl, output_dir, updates=120, batch_size=8,
                learning_rate=3e-5, seed=20261106, base_revision=BASE_REVISION):
    if not 1 <= updates <= 200 or batch_size != 8:
        raise ValueError("Bounded training requires 1..200 updates and batch size 8")
    output_dir = Path(output_dir)
    if output_dir.exists() and any(output_dir.iterdir()):
        raise ValueError("Training output directory must be empty")
    torch = configure_torch(seed)
    tokenizer, model, loading = load_local(model_dir)
    examples = read_examples(train_jsonl, tokenizer, require_target=True)
    wrapper = selected_wrapper(model).train()
    optimizer = torch.optim.AdamW(wrapper.parameters(), lr=learning_rate,
                                  betas=(0.9, 0.999), eps=1e-8, weight_decay=0.01)
    rng = random.Random(seed)
    order, cursor = list(range(len(examples))), 0
    rng.shuffle(order)
    losses, started = [], time.perf_counter()
    for step in range(updates):
        chosen = []
        while len(chosen) < batch_size:
            if cursor == len(order):
                rng.shuffle(order)
                cursor = 0
            chosen.append(examples[order[cursor]])
            cursor += 1
        arrays = padded_arrays([x["input_ids"] for x in chosen],
                               [x["position"] for x in chosen], pad_id=tokenizer.pad_token_id)
        tensors = tuple(torch.from_numpy(x) for x in arrays)
        target = torch.tensor([x["target_id"] for x in chosen], dtype=torch.long)
        optimizer.zero_grad(set_to_none=True)
        logits = wrapper(*tensors)
        loss = torch.nn.functional.cross_entropy(logits, target)
        if not torch.isfinite(loss):
            raise ValueError("Nonfinite training loss")
        loss.backward()
        torch.nn.utils.clip_grad_norm_(wrapper.parameters(), max_norm=1.0, error_if_nonfinite=True)
        optimizer.step()
        losses.append(float(loss.detach()))
        if (step + 1) % 20 == 0:
            print(json.dumps({"update": step + 1, "loss": losses[-1],
                              "elapsed_seconds": time.perf_counter() - started}), flush=True)
    elapsed = time.perf_counter() - started
    output_dir.mkdir(parents=True, exist_ok=True)
    model.eval().save_pretrained(str(output_dir), safe_serialization=True)
    tokenizer.save_pretrained(str(output_dir))
    if (Path(model_dir) / "vocab.txt").is_file():
        shutil.copyfile(Path(model_dir) / "vocab.txt", output_dir / "vocab.txt")
    import transformers
    manifest = {
        "task": "Masked-token cross entropy on selected hidden rows; not a validated corrector",
        "base_model": "dbmdz/bert-mini-historic-multilingual-cased",
        "base_revision": base_revision,
        "base_safetensors_sha256": file_hash(Path(model_dir) / "model.safetensors"),
        "training_data_sha256": file_hash(train_jsonl), "training_examples": len(examples),
        "updates": updates, "batch_size": batch_size, "seed": seed,
        "optimizer": "AdamW", "learning_rate": learning_rate, "betas": [0.9, 0.999],
        "epsilon": 1e-8, "weight_decay": 0.01, "gradient_clip_norm": 1.0,
        "scheduler": "none", "full_model_trainable": True, "precision": "float32",
        "intra_op_threads": 2, "inter_op_threads": 2, "deterministic_algorithms": True,
        "elapsed_training_seconds": elapsed, "losses": losses,
        "torch_version": torch.__version__, "transformers_version": transformers.__version__,
        "python_version": platform.python_version(), "platform": platform.platform(),
        "loading_info": loading,
        "output_safetensors_sha256": file_hash(output_dir / "model.safetensors"),
        "validation_access": "Training function reads only the provided training JSONL",
    }
    (output_dir / "training-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("--model-dir", required=True)
    export.add_argument("--output-dir", required=True)
    export.add_argument("--validation-jsonl")
    train = commands.add_parser("train")
    train.add_argument("--model-dir", required=True)
    train.add_argument("--train-jsonl", required=True)
    train.add_argument("--output-dir", required=True)
    train.add_argument("--updates", type=int, default=120)
    train.add_argument("--batch-size", type=int, default=8)
    train.add_argument("--learning-rate", type=float, default=3e-5)
    train.add_argument("--seed", type=int, default=20261106)
    train.add_argument("--base-revision", default=BASE_REVISION)
    args = vars(parser.parse_args())
    command = args.pop("command")
    result = export_model(**args) if command == "export" else train_model(**args)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
