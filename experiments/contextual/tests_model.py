"""Run with CONTEXT_MODEL_DIR pointing at the pinned local safe model."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from model import configure_torch, default_validation, load_local, padded_arrays, selected_wrapper, export_model


@unittest.skipUnless(os.environ.get("CONTEXT_MODEL_DIR"), "Set CONTEXT_MODEL_DIR for real-weight parity")
class RealWeightParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.torch = configure_torch()
        cls.tokenizer, cls.model, cls.loading = load_local(os.environ["CONTEXT_MODEL_DIR"])

    def test_runtime_tokenizer_matches_model_tokenizer(self):
        from tokenizers import BertWordPieceTokenizer
        runtime = BertWordPieceTokenizer(
            str(Path(os.environ["CONTEXT_MODEL_DIR"]) / "vocab.txt"),
            lowercase=False, strip_accents=False,
        )
        texts = [
            "Bitte überweise fünf Euro an die Straße.",
            "Grüße, äußere Größe, Überweisung und Fußgänger.",
            "Please send the [MASK] tomorrow.",
            "Thank you for your email!", "Can't we meet on Friday?",
            "E-Mail und Hardware: i5-1038NG7.",
            "Ä Ö Ü ä ö ü ß ẞ", "Eine neue Zeile.\nNächste Zeile.",
        ]
        for text in texts:
            with self.subTest(text=text):
                self.assertEqual(runtime.encode(text).ids, self.tokenizer.encode(text))
                manual = [self.tokenizer.cls_token_id]
                manual += runtime.encode(text, add_special_tokens=False).ids
                manual += [self.tokenizer.sep_token_id]
                self.assertEqual(manual, self.tokenizer.encode(text))

    def test_selected_head_matches_full_trained_mlm(self):
        import numpy as np
        examples = default_validation(self.tokenizer)
        arrays = padded_arrays([x["input_ids"] for x in examples], [x["position"] for x in examples])
        tensors = tuple(self.torch.from_numpy(x) for x in arrays)
        with self.torch.inference_mode():
            selected = selected_wrapper(self.model).eval()(*tensors).numpy()
            full = self.model(input_ids=tensors[0], attention_mask=tensors[1]).logits
            expected = full[self.torch.arange(len(examples)), tensors[2]].numpy()
        np.testing.assert_allclose(selected, expected, rtol=1e-5, atol=1e-4)
        np.testing.assert_array_equal(selected.argmax(axis=1), expected.argmax(axis=1))
        self.assertFalse(self.loading.get("missing_keys"))
        self.assertFalse(self.tokenizer.do_lower_case)

    def test_export_parity_and_runtime_without_torch(self):
        with tempfile.TemporaryDirectory() as output:
            manifest = export_model(os.environ["CONTEXT_MODEL_DIR"], output)
            self.assertEqual(manifest["fp32"]["argmax_equal"], 8)
            self.assertLess(manifest["fp32"]["max_abs_logit_error"], 1e-4)
            # INT8 differences are measured, not granted an invented quality bound.
            self.assertEqual(manifest["int8"]["examples"], 8)
            code = """
import json, sys
from model import ORTScorer
scorer = ORTScorer(sys.argv[1])
output = scorer.score([[2, 4, 3]], [1])
assert output.shape == (1, 32000)
assert 'torch' not in sys.modules
print(json.dumps({'shape': list(output.shape), 'torch_imported': 'torch' in sys.modules}))
"""
            result = subprocess.run([sys.executable, "-c", code,
                                     str(Path(output) / "selected-mlm.int8.onnx")],
                                    cwd=Path(__file__).parent, capture_output=True, text=True, check=True)
            self.assertFalse(json.loads(result.stdout)["torch_imported"])


if __name__ == "__main__":
    unittest.main()
