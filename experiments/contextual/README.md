# Context lab 1

This is a research experiment, not a replacement release. Browser RC5 and native
Outlook RC4 remain the shipping candidates. No production correction code changed.

The user allowed conventional training on 2026-11-06. We tested a small trained
context encoder and a short domain-adaptation run. Neither improved the fresh
grammar/context audit. Do not interpret the model file as a working grammar
corrector or enable its edits in an editor.

## What ran

- Baseline: browser commit `57ed9d3c4e1b087c4f27fdd9eeb8fc41db17c32d`.
- Encoder: [hmBERT Mini](https://huggingface.co/dbmdz/bert-mini-historic-multilingual-cased),
  revision `4a0964c747fd6c06a20e8c0ca32bc27a23a6ad34`, MIT. This pretrained
  four-layer encoder covers English and German, but its historical newspaper/OCR
  domain is poorly matched to modern email.
- Training data: 3,764 unique masked-word contexts from 1,000 known synthetic
  development documents. The 120-update run presented 960 examples, batch 8,
  AdamW learning rate 0.00003. It adapted the whole encoder to predicting masked
  words. It did **not** train an error detector or grammatical edit tagger.
- Two CPU threads. The update loop took 25.47 seconds; the whole training process
  peaked at 817.91 MiB RSS. A repeated run produced identical safetensors bytes.
- A separately learned logistic acceptance head used 319 contextual proposals.
  A different 500-document calibration cohort provided 140 proposals. There was
  no document, input or corrected-text overlap between cohorts.
- The threshold was selected strictly above every observed calibration negative,
  with a minimum score of 0.99. These scores are not calibrated probabilities.
  Zero calibration errors follow threshold selection and are not independent
  evidence of a zero error rate. An earlier arbitrary 0.01 score buffer exceeded
  1 and rejected everything; its heads are retained as rejected diagnostics.

## Results

| Set | RC5 exact documents | Context encoder | After short fine-tune |
|---|---:|---:|---:|
| Known calibration, 500 documents | 368 | 375 | 374 |
| Fresh independent audit, 120 documents | 61 | 61 | 61 |

On calibration the context-only pipeline added 13 wanted edits and the adapted
pipeline added 10. Both added zero unwanted edits. The fresh audit had 60 clean
controls and 60 correction documents, spanning spelling, valid-word confusions,
agreement and word order. Every pipeline preserved all 60 controls and completed
only 1 of 60 correction documents. Both new heads abstained on every fresh
proposal. Thus the audit provides **no coverage improvement** and no evidence of
successful neural grammar correction. It is not comparable to the spelling-only
5,000-case corpus as a single accuracy percentage.

The independently authored audit was sealed before implementation-owner access.
Both models, heads and inference scripts were frozen before its first evaluation.
All final decisions are in the downloadable raw reports. No model or threshold
was changed after that evaluation. The audit is now known regression data.

The existing proposal stage only revisits unknown words with one-edit dictionary
candidates; just 10 offers reached it in the fresh audit, and only six had a
single-subword candidate usable by this pilot. Most valid-word grammar errors
never reached the neural model. This is a structural limitation of the experiment.

## Resources and numerical checks

The selected trained FP32 ONNX file is 46,413,537 bytes, SHA-256
`03c1f9d071e72b5ae87717cabdc644fe4a0e710caaaca83c85cbcc6d069aa5f4`.
The selected-position head avoids materializing vocabulary scores at every word.
Eight numerical probes retained every PyTorch argmax; maximum logit error was
0.000023842. Dynamic padded batches and length 63 were also checked. The ONNX
scorer imports no Torch. Three substantive model/export tests passed.

Signed INT8 exports were rejected: they preserved only 4/8 base and 3/8 adapted
argmax probes while saving little disk space. They are not distributed as the
selected model. A 136 MB multilingual DistilBERT pilot briefly exceeded 1 GiB;
that result demonstrates why download size must not be treated as runtime RAM.

On the user's Intel i5-1038NG7, two synthetic 1,000-word stress inputs took
2.13–2.36 seconds through the complete cold research CLI, including three fresh
process starts and Node proposal generation. Largest stage RSS was about 350 MiB;
stages ran sequentially, not concurrently. The context inference portion alone
took 97–109 ms for 21–24 proposals; its process peaked around 227–233 MiB.
These are not warm resident-pipeline, Firefox, or Outlook measurements. There is
no demonstrated one-second full-path result for this prototype.

## Reproduce

Use the pinned research source and a separate virtual environment. Dependency
versions are in `requirements-lock.txt`; install CPU PyTorch from its official
CPU wheel index, then the remaining locked packages from PyPI. No AUR packages
are needed. Models are local safetensors/ONNX data; remote code is disabled.

The downloadable lab bundle contains the selected trained ONNX, acceptance head,
tokenizer vocabulary, saved trainable safetensors, training/calibration cohorts,
masked training examples, sealed audit, numerical/training manifests and reports.
It does not contain the unchanged static engine; the scripts use the repository's
`packages/core` and existing Node dependencies.

```sh
node experiments/contextual/proposals.mjs tests/scale-corpus/dev.json train-proposals.json 1000
python experiments/contextual/prepare.py --model models/base --input train-proposals.json --output masked-train.jsonl
python experiments/contextual/model.py train --model-dir models/base --train-jsonl masked-train.jsonl --output-dir models/adapted --updates 120
python experiments/contextual/model.py export --model-dir models/adapted --output-dir models/adapted/onnx
python experiments/contextual/score.py --model models/adapted/onnx/selected-mlm.fp32.onnx --tokenizer models/base --input train-proposals.json --output train-features.json
```

Prepare the separate calibration corpus with the same scripts. Fit the head using
`calibrate.py`; use `evaluate.py` to apply frozen decisions and `benchmark.py` for
the explicitly cold sequential CLI protocol. The bundle paths map the original
`work/context-lab` files to public relative paths. Normalized manifest paths and
their pointer hashes are identified in the packaging receipt. Model binaries,
corpus text and feature values stay unchanged.

## Next experiment

Train a compact **unmasked edit detector/tagger**, including explicit KEEP and
permitted replacement/append/delete actions. Score valid words too. Use real
error/correction pairs and corrected-side identity controls, not masked clean
sentences alone. Compare widened candidates with unchanged context scoring
against actual supervised tagging so an apparent gain is attributable.

Candidate public training sources include English
[ErAConD](https://github.com/yuanxun-yx/eracond), MIT, and the original
[Falko/MERLIN release](https://github.com/adrianeboyd/boyd-wnut2018), with distinct
Falko CC BY 3.0 and MERLIN CC BY-SA 4.0 terms. Split by conversation/document,
check representable edit coverage before training, and preserve source licenses.
These data have **not** been downloaded or used in this experiment.

The method follows the edit-tagging direction described by
[GECToR](https://aclanthology.org/2020.bea-1.16/). A new independent audit is needed
after choosing the next model and thresholds. CPU/RAM targets remain acceptance
checks, not assumptions. Zero observed unwanted edits remains the priority.

## Credits and licenses

LocalCorrect source remains GPL-3.0-only. Original hmBERT weights are MIT,
credited to Open Source at the Bayerische Staatsbibliothek. The adaptation and
learned head are offered under CC BY-SA 4.0 with the source-corpus attribution
and upstream MIT notice retained. Do not describe this mixed-source experiment
as an entirely MIT-licensed model. The model card and exact upstream license
accompany the bundle.
The static baseline's SymSpell inspiration, language resources and licenses stay
documented in the project README and `packages/core/THIRD_PARTY.md`. Synthetic
corpus provenance is in `tests/scale-corpus/SOURCES.md`. No private correspondence
or chat text entered the public training/evaluation data.
