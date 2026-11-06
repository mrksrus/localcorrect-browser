#!/usr/bin/env python3
"""Calibration policy regressions using generated arithmetic records only.

Run with stdlib Python. No trained corpus, calibration set or holdout is read.
Every score file and policy output lives in a disposable temporary directory.
"""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CALIBRATOR = ROOT / "scripts/calibrate-context.py"


class CalibrationPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="localcorrect-policy-test-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.model = {"format": "localcorrect-context-encoder-v1", "modelSha256": "1" * 64,
                      "actions": [{"kind": "KEEP"}, {"kind": "REPLACE", "language": "en",
                                  "trigger": "is", "replacement": "are", "trainCount": 10}]}

    def row(self, document_id, margin=10.0, wanted=True):
        edit = {"offset": 10, "length": 2, "original": "is", "replacement": "are"}
        return {"id": document_id, "document_id": document_id,
                "source": "generated-policy-regression", "language": "en",
                "input": "Two cubes is blue.",
                "expected": "Two cubes are blue." if wanted else "Two cubes is blue.",
                "edits": [edit] if wanted else [],
                "proposals": [{**edit, "actionId": 1, "trainCount": self.model["actions"][1]["trainCount"],
                               "margin": margin, "gap": margin,
                               "probability": 1 / (1 + math.exp(-margin))}]}

    def support(self, survivors):
        return [self.row("synthetic-" + str(index), 10.0 if index < survivors else 1.0)
                for index in range(8)]

    def calibrate(self, support, human=(), other=(), declare_support=True):
        model_path = self.directory / "model.json"
        model_path.write_text(json.dumps(self.model))
        model_sha = hashlib.sha256(model_path.read_bytes()).hexdigest()
        command = [sys.executable, str(CALIBRATOR), "--model", str(model_path),
                   "--output", str(self.directory / "policy.json"),
                   "--report", str(self.directory / "report.json"),
                   "--human-calibration-name", "human.json", "--min-margin", "2",
                   "--min-probability", ".9"]
        if declare_support:
            command += ["--support-calibration-name", "support.json"]
        # Hash actual functional code so the production provenance check runs.
        runtime_hashes = {name: hashlib.sha256((ROOT / "packages/core/src" / name).read_bytes()).hexdigest()
                          for name in ("context-model.js", "context-encode.js", "index.js")}
        for name, rows in (("support", support), ("human", human), ("other", other)):
            path = self.directory / (name + ".json")
            path.write_text(json.dumps({"modelSha256": model_sha, "onnxSha256": self.model["modelSha256"],
                                        "runtimeSha256": runtime_hashes, "rows": list(rows)}))
            command += ["--input", str(path)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        return (json.loads((self.directory / "policy.json").read_text()),
                json.loads((self.directory / "report.json").read_text()))

    def test_two_synthetic_survivors_and_one_human_cannot_enable_action(self):
        policy, report = self.calibrate(self.support(2), human=[self.row("human-0")])
        self.assertEqual(policy["actions"], {})
        self.assertEqual(report["enabledActions"], 0)

    def test_three_synthetic_survivors_enable_supported_action(self):
        policy, report = self.calibrate(self.support(3))
        self.assertEqual(set(policy["actions"]), {"1"})
        detail = report["details"][0]
        self.assertEqual(detail["syntheticPositiveDocuments"], 8)
        self.assertEqual(detail["syntheticSurvivingEdits"], 3)
        self.assertEqual(detail["humanPositiveDocuments"], 0)
        self.assertEqual(detail["calibrationUnwanted"], 0)

    def test_negative_from_any_input_raises_margin_by_half_a_logit(self):
        policy, report = self.calibrate(self.support(3), other=[self.row("negative-0", 6.25, wanted=False)])
        self.assertEqual(policy["actions"]["1"]["minMargin"], 6.75)
        self.assertTrue(math.isfinite(policy["actions"]["1"]["minMargin"]))
        self.assertEqual(report["details"][0]["observedNegatives"], 1)
        self.assertEqual(report["details"][0]["calibrationUnwanted"], 0)
        self.assertEqual(report["details"][0]["syntheticSurvivingEdits"], 3)

    def test_undeclared_synthetic_source_cannot_supply_support(self):
        policy, _ = self.calibrate(self.support(8), declare_support=False)
        self.assertEqual(policy["actions"], {})

    def test_repeated_rows_from_one_document_cannot_supply_eight_documents(self):
        rows = [self.row("same-document") for _ in range(8)]
        policy, _ = self.calibrate(rows)
        self.assertEqual(policy["actions"], {})

    def test_three_training_occurrences_cannot_enable_action(self):
        self.model["actions"][1]["trainCount"] = 3
        policy, _ = self.calibrate(self.support(8))
        self.assertEqual(policy["actions"], {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
