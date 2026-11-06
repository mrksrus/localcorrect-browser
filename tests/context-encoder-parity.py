#!/usr/bin/env python3
"""Check fp32 ONNX sparse edit logits against frozen PyTorch synthetic probes.

Usage: context-encoder-parity.py MODEL.onnx METADATA.json PARITY.json
       [--runtime-output JS_OR_NATIVE_OUTPUT.json] [--report REPORT.json]
Runtime output is {probes:[{logits: nested float32-compatible arrays}]} and may
also contain tokenizerProbes with the exact token/chunk representation exported
by the trainer. This test does not measure correction quality or choose policy.
"""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import time


def check_close(actual, expected, tolerance, label):
    import numpy as np
    actual, expected = np.asarray(actual), np.asarray(expected)
    assert actual.shape == expected.shape, f"{label}: shape {actual.shape} != {expected.shape}"
    assert np.isfinite(actual).all(), label + " has nonfinite output"
    maximum = float(np.abs(actual-expected).max(initial=0))
    assert maximum <= tolerance, f"{label}: max difference {maximum} > {tolerance}"
    return maximum


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("parity", type=Path)
    parser.add_argument("--runtime-output", type=Path, action="append", default=[])
    parser.add_argument("--report", type=Path)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    started = time.monotonic()
    import numpy as np
    import onnx
    import onnxruntime as ort
    model_sha = hashlib.sha256(args.model.read_bytes()).hexdigest()
    metadata, parity = json.loads(args.metadata.read_text()), json.loads(args.parity.read_text())
    assert metadata["format"] == "localcorrect-context-encoder-v1"
    assert parity["format"] == "localcorrect-context-encoder-parity-v1"
    assert model_sha == metadata["modelSha256"] == parity["modelSha256"], "Model hash mismatch"
    assert metadata["training"]["calibrationOrTestUsed"] is False
    assert parity["probes"], "No arithmetic probes"
    assert metadata["tokenizer"]["candidateWidth"] == 9
    for trigger, rows in metadata["candidatesByTrigger"].items():
        assert 1 <= len(rows) <= 8 and len(set(rows)) == len(rows), trigger + " candidate bounds"
        for row in rows:
            assert 0 < row < len(metadata["actions"]), trigger + " candidate id"
            action = metadata["actions"][row]
            assert trigger == action["language"] + "|" + action["trigger"], trigger + " action mismatch"
    graph = onnx.load(str(args.model), load_external_data=False)
    onnx.checker.check_model(graph)
    assert all(node.domain in ("", "ai.onnx") for node in graph.graph.node), "Custom ONNX operators"
    assert all(not tensor.external_data for tensor in graph.graph.initializer), "External tensor files"
    operations = sorted({node.op_type for node in graph.graph.node})
    del graph
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    load_started = time.monotonic()
    session = ort.InferenceSession(str(args.model), sess_options=options, providers=["CPUExecutionProvider"])
    load_seconds = time.monotonic()-load_started
    names = {value.name: value.type for value in session.get_inputs()}
    assert names == {"input_ids": "tensor(int64)", "attention_mask": "tensor(int64)",
                     "word_positions": "tensor(int64)", "candidate_ids": "tensor(int64)",
                     "candidate_mask": "tensor(float)"}, str(names)
    assert [value.name for value in session.get_outputs()] == ["logits"]
    maximum_error, elapsed, word_count = 0.0, [], 0
    for index, probe in enumerate(parity["probes"]):
        inputs = {key: np.asarray(value, dtype=np.float32 if key == "candidate_mask" else np.int64)
                  for key, value in probe["inputs"].items()}
        assert inputs["candidate_ids"].shape[-1] == 9
        assert (inputs["candidate_ids"][:, :, 0] == 0).all(), "KEEP candidate must be first"
        assert (inputs["candidate_mask"][:, :, 0] == 1).all(), "Real probe words require KEEP"
        run_started = time.monotonic()
        logits = session.run(["logits"], inputs)[0]
        elapsed.append(time.monotonic()-run_started)
        maximum_error = max(maximum_error, check_close(logits, probe["logitsFloat32"],
                                                       parity["absoluteTolerance"], f"ORT probe {index}"))
        assert (logits[inputs["candidate_mask"] == 0] == -10000).all(), "Padding candidate mask"
        word_count += inputs["word_positions"].size
    # Explicitly exercise dynamic batch, sequence, word count and padding using
    # three differently shaped synthetic probes in a single batch.
    samples = parity["probes"][:3]
    sequence = max(len(item["inputs"]["input_ids"][0]) for item in samples)
    words = max(len(item["inputs"]["word_positions"][0]) for item in samples)
    count = len(samples)
    padded = {"input_ids": np.full((count, sequence), metadata["tokenizer"]["padId"], dtype=np.int64),
              "attention_mask": np.zeros((count, sequence), dtype=np.int64),
              "word_positions": np.zeros((count, words), dtype=np.int64),
              "candidate_ids": np.zeros((count, words, 9), dtype=np.int64),
              "candidate_mask": np.zeros((count, words, 9), dtype=np.float32)}
    for index, sample in enumerate(samples):
        for key, values in sample["inputs"].items():
            values = np.asarray(values)[0]
            if values.ndim == 1:
                padded[key][index, :len(values)] = values
            else:
                padded[key][index, :len(values), :] = values
    logits = session.run(["logits"], padded)[0]
    for index, sample in enumerate(samples):
        expected = np.asarray(sample["logitsFloat32"])[0]
        maximum_error = max(maximum_error, check_close(logits[index, :len(expected)], expected,
                                                       parity["absoluteTolerance"], f"Padded batch probe {index}"))
    assert (logits[padded["candidate_mask"] == 0] == -10000).all(), "Padded batch candidate mask"
    runtime_results = []
    for path in args.runtime_output:
        runtime = json.loads(path.read_text())
        assert len(runtime["probes"]) == len(parity["probes"])
        runtime_error = 0
        for index, (actual, expected) in enumerate(zip(runtime["probes"], parity["probes"])):
            values = actual["logits"] if isinstance(actual, dict) else actual
            runtime_error = max(runtime_error, check_close(values, expected["logitsFloat32"],
                                                           parity["absoluteTolerance"], f"{path} probe {index}"))
        if "tokenizerProbes" in runtime:
            assert runtime["tokenizerProbes"] == parity["tokenizerProbes"], str(path) + " tokenizer mismatch"
        runtime_results.append({"path": str(path), "maximumAbsoluteError": runtime_error})
    result = {"status": "pass", "modelSha256": model_sha, "onnxRuntimeVersion": ort.__version__,
              "standardOnnxOperators": operations, "syntheticProbes": len(parity["probes"]),
              "syntheticTokenizerCases": len(parity["tokenizerProbes"]),
              "selectedWords": word_count, "maximumAbsoluteError": maximum_error,
              "absoluteTolerance": parity["absoluteTolerance"], "dynamicPaddedBatch": "pass",
              "sessionLoadSeconds": load_seconds, "probeInferenceSeconds": sum(elapsed),
              "maximumProbeSeconds": max(elapsed), "threads": args.threads,
              "peakRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              "totalSeconds": time.monotonic()-started, "runtimeOutputs": runtime_results,
              "scope": "CPU ONNX arithmetic portability on fixed synthetic inputs, not correction quality"}
    if args.report:
        args.report.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
