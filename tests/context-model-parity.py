#!/usr/bin/env python3
"""Verify declarative context model arithmetic and optional JS/Jint outputs.

Usage: python context-model-parity.py MODEL.json PROBES.json
       [--runtime-output node-output.json] [--runtime-output jint-output.json]
Runtime files contain `tokenizerProbes` and/or `probes`; feature probe objects
have bucketIds, slotScalars, inputFeatures, hidden, and logits or logitsDouble.
This checks arithmetic portability, not correction quality or calibration.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re


def close(actual, expected, tolerance, label):
    if isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(expected), label + " length"
        for index, (a, b) in enumerate(zip(actual, expected)):
            close(a, b, tolerance, label + "[" + str(index) + "]")
    elif isinstance(expected, (int, float)):
        assert isinstance(actual, (int, float)) and math.isfinite(actual), label + " finite"
        assert abs(actual-expected) <= tolerance, f"{label}: {actual} != {expected}"
    else:
        assert actual == expected, label


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("parity", type=Path)
    parser.add_argument("--runtime-output", type=Path, action="append", default=[])
    args = parser.parse_args()
    model = json.loads(args.model.read_text())
    parity = json.loads(args.parity.read_text())
    assert model["format"] == "localcorrect-context-edit-v1"
    assert hashlib.sha256(args.model.read_bytes()).hexdigest() == parity["modelSha256"]
    spec, weights = model["featureSpec"], model["weights"]
    tolerance = parity["absoluteTolerance"]
    assert len(weights["embedding"]) == spec["buckets"]
    assert all(len(row) == spec["embeddingDim"] for row in weights["embedding"])
    assert len(weights["hiddenWeight"]) == len(weights["hiddenBias"]) == spec["hiddenSize"]
    assert all(len(row) == spec["inputSize"] for row in weights["hiddenWeight"])
    assert len(weights["outputWeight"]) == len(weights["outputBias"]) == len(model["actions"])
    assert all(len(row) == spec["hiddenSize"] for row in weights["outputWeight"])
    fold_table = dict(zip(spec["foldUpper"], spec["foldLower"]))
    word_re = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+)*\Z")
    token_re = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+)*|[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]")

    def folded(token):
        return "".join(fold_table.get(c, c) for c in token)

    def bucket(token, language):
        hash_value = 2166136261
        raw = (language + "|" + folded(token)).encode("utf-16-le")
        for index in range(0, len(raw), 2):
            hash_value = ((hash_value ^ int.from_bytes(raw[index:index+2], "little"))*16777619) & 0xFFFFFFFF
        return 2 + hash_value % (spec["buckets"]-2)

    def scalars(token):
        flags = [char in spec["foldUpper"] for char in token
                 if char in spec["foldUpper"] or char in spec["foldLower"]]
        return [int(word_re.fullmatch(token) is not None),
                int(bool(flags) and flags[0] and not any(flags[1:])),
                int(bool(flags) and all(flags)), int(bool(flags) and not any(flags))]

    for item in parity["tokenizerProbes"]:
        actual = []
        for match in token_re.finditer(item["text"]):
            token = match.group()
            actual.append({"text": token,
                           "start": len(item["text"][:match.start()].encode("utf-16-le"))//2,
                           "end": len(item["text"][:match.end()].encode("utf-16-le"))//2,
                           "folded": folded(token), "scalars": scalars(token),
                           "hashEn": bucket(token, "en"), "hashDe": bucket(token, "de")})
        assert actual == item["tokens"], "Tokenizer/fold/UTF16 hashing probe"
    max_float32_error = 0
    for probe in parity["probes"]:
        bucket_ids, slot_flags, features = [], [], []
        for index in range(probe["tokenIndex"]-spec["radius"], probe["tokenIndex"]+spec["radius"]+1):
            if index < 0 or index >= len(probe["tokens"]):
                token_bucket, flags = (0 if index < 0 else 1), [0, 0, 0, 0]
            else:
                token = probe["tokens"][index]
                token_bucket, flags = bucket(token, probe["language"]), scalars(token)
            bucket_ids.append(token_bucket)
            slot_flags.append(flags)
            features.extend(weights["embedding"][token_bucket])
            features.extend(flags)
        features.extend([int(probe["language"] == "en"), int(probe["language"] == "de")])
        assert bucket_ids == probe["bucketIds"]
        assert slot_flags == probe["slotScalars"]
        close(features, probe["inputFeatures"], 0, "features")
        hidden = []
        for weight, bias in zip(weights["hiddenWeight"], weights["hiddenBias"]):
            total = bias
            for x, w in zip(features, weight):
                total += x*w
            hidden.append(math.tanh(total))
        close(hidden, probe["hidden"], 1e-12, "hidden")
        logits = []
        for row_id in probe["candidateRowIds"]:
            total = weights["outputBias"][row_id]
            for x, w in zip(hidden, weights["outputWeight"][row_id]):
                total += x*w
            logits.append(total)
        close(logits, probe["logitsDouble"], 1e-12, "logitsDouble")
        close(logits, probe["logitsFloat32"], tolerance, "logitsFloat32")
        max_float32_error = max(max_float32_error, *(abs(a-b) for a, b in zip(logits, probe["logitsFloat32"])))
    for output_path in args.runtime_output:
        runtime = json.loads(output_path.read_text())
        if "tokenizerProbes" in runtime:
            assert len(runtime["tokenizerProbes"]) == len(parity["tokenizerProbes"])
            for actual_probe, expected_probe in zip(runtime["tokenizerProbes"], parity["tokenizerProbes"]):
                assert actual_probe["text"] == expected_probe["text"]
                assert len(actual_probe["tokens"]) == len(expected_probe["tokens"])
                for actual, expected in zip(actual_probe["tokens"], expected_probe["tokens"]):
                    for field in ("text", "start", "end"):
                        assert actual[field] == expected[field], str(output_path) + " tokenizer " + field
                    if "word" in actual:
                        assert actual["word"] == bool(expected["scalars"][0])
                    for field in ("folded", "scalars", "hashEn", "hashDe"):
                        if field in actual:
                            assert actual[field] == expected[field]
        assert len(runtime["probes"]) == len(parity["probes"]), str(output_path) + " probe count"
        for index, (actual, expected) in enumerate(zip(runtime["probes"], parity["probes"])):
            for field in ("bucketIds", "slotScalars", "inputFeatures", "hidden"):
                if field in actual:
                    close(actual[field], expected[field], tolerance, f"{output_path} probe {index} {field}")
            assert "logits" in actual or "logitsDouble" in actual, "Runtime must return logits"
            close(actual.get("logits", actual.get("logitsDouble")), expected["logitsDouble"], tolerance,
                  f"{output_path} probe {index} logits")
    print(json.dumps({"status": "pass", "modelSha256": parity["modelSha256"],
                      "probes": len(parity["probes"]), "tokenizerProbes": len(parity["tokenizerProbes"]),
                      "runtimeOutputs": [str(x) for x in args.runtime_output],
                      "maxFloat32AbsoluteError": max_float32_error,
                      "absoluteTolerance": tolerance}))


if __name__ == "__main__":
    main()
