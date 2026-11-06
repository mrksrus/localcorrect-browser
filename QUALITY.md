# RC6 quality and limits

RC6 adds a trained, local contextual edit model to the RC5 spelling engine. It is a small improvement in supported partial corrections, with substantial misses. It does not meet the goal of correcting nearly every sentence. The independent synthetic audit shows no coverage gain over RC5.

## Frozen synthetic results

| Set and role | Wanted edits | Unwanted edits | Missed edits | Exact documents | Clean controls preserved |
|---|---:|---:|---:|---:|---:|
| 5,600 known regression documents | 4,453 | 0 | 2,119 | 4,035/5,600 | 2,320/2,320 |
| 400 English development-calibration documents | 9 | 0 | 191 | 209/400 | 200/200 |
| 200 independent documents, fresh at first evaluation | 9 | 0 | 107 | 104/200 | 100/100 |

Both saved modes use the same policy. A wrong replacement counts as an unwanted edit and a missed intended edit. Exactness compares the entire result against the reference. Gold spans may include insertions, deletions and phrase changes that this model cannot perform; those remain misses. The evaluator accepts the original audit schemas without rewriting their gold files.

The 400 development cases were used to choose thresholds. They are not unseen validation. All earlier 5,600 documents were already known. The new 200-document audit was authored independently, with the model, training data, existing gold and model outputs withheld. Model, metadata, policy and functional source were frozen before evaluation. Its sealed file digest is retained in `evaluation-freeze.json`.

On the fresh set, RC5 and RC6 both make 9 wanted edits, no unwanted edits and 107 misses. Both preserve all 100 clean documents and completely correct only 4 of the 100 error-bearing documents. The other 100 exact documents are clean controls. This result provides preservation evidence and exposes weak coverage; it does not demonstrate general coverage superiority.

Zero observed unwanted edits and 100% observed edit precision on these finite synthetic sets are not a population guarantee. They do not mean that 100% or 99% of errors are fixed. The primary preference remains abstention over an unwanted change.

## Real learner test

The separate 3,200-pair learner test was not used for gradient training, action selection or threshold calibration. RC6 adds 21 edits across 14 documents. A strict single-token alignment counts 9 exact token matches and 12 mismatches because reference corrections also change nearby punctuation, multiple words or word order.

Two separately assigned reviewers inspected all 21 additions against the full human references. Both judged all 21 to be supported partial corrections, with no reference contradiction identified. They are mostly capitalization and three German dative-plural repairs. This supplemental semantic audit does not replace the preserved first-pass numbers or establish a natural population precision rate.

Whole-document exactness remains 617/3,200 for both versions. Learner references contain many corrections the small model cannot express. They can also retain errors or regional wording. The static engine's existing reference mismatches must not automatically be described as wrong edits; raw single-token counts are retained as `strictReferenceMismatchedEdits` in the aggregate report. Raw learner text is not redistributed.

Reports and the frozen policy are in [tests/context-results](tests/context-results). Source licenses, source hashes, document-level splits and duplicate checks are in the context source manifests and [MODEL.md](MODEL.md). The synthetic development and independent audit data are published in full. No private chat or email text is included.

## Model and safeguards

The FP32 ONNX model is 47,246,299 bytes, separate from the existing static language data. It fine-tunes the MIT-licensed hmBERT Mini base with actual gradient optimization. It was not manually written as millions of weights and was not trained from scratch. Training uses 21,328 pairs, including 2,265 explicitly labeled synthetic inverse-noise examples derived from weakly clean Wikipedia training references.

The head has 1,200 learned replacement actions, but the calibrated release policy enables only 13. A trigger has at most eight candidates plus KEEP. Training support, repeated calibration support, a score-margin buffer above observed negatives and original-text protections gate every addition. These thresholds are empirical. Softmax scores are not certified confidence levels.

Static edits take priority. Names after greetings, quotations, reply/signature tails, URLs, code, variables and joined identifiers are protected. The policy must match both model and action/tokenizer metadata identities. Missing or failed inference aborts the operation before page edits. A missing or mismatched policy abstains from neural additions. No rule or neural weight is read from evaluation gold at runtime.

Independent review found and fixed metadata mislabeling, selection-context protection and a long-document proposal-limit interaction. Dedicated regressions exercise these cases. The Windows helper sets the version-specific telemetry opt-outs before process launch and initialization. Physical Outlook acceptance remains separate.

## CPU and memory

Measured on an Intel Core i5-1038NG7, four cores/eight threads, 31.1 GiB DDR4 RAM, Linux, Node 26.7.0:

- Whole Node CPU/WASM reference, 1,000-word English emails: about 284–321 ms after initialization.
- The equivalent German fixtures: about 65–86 ms. Their enabled neural triggers are rarer, so more independent chunks can be skipped.
- Peak whole-process RSS: about 579 MiB. Model-session construction: about 641 ms, with first spelling-table initialization additionally included in the first correction.

These are measured synthetic fixtures, not browser-wide RAM or Windows/Outlook timing. The packaged browser uses one CPU/WASM inference thread. It skips only independent chunks that cannot produce an enabled edit; all competitors in used chunks remain unchanged. Full and pruned paths have explicit equivalence regressions. See [the raw benchmark](benchmarks/rc6-node-cpu.json).

The earlier full-model, unpruned reference measured roughly 0.8–1.1 seconds for the same 1,000-word fixtures. The selected runtime stays below the approximate 1 GB ceiling without a larger model. Native helper and hosted Windows measurements are recorded separately in the native candidate's build evidence; they must not be inferred from Node results.

## Reproduction and release evidence

`npm ci && npm run check` builds the packages and exercises core, DOM, shortcut, actual Firefox/Chrome, ONNX arithmetic, full-corpus inference and archive checks. Trusted local Firefox/geckodriver binaries are needed for the Firefox harness. `tests/context-encoder-runtime.mjs` verifies 25 tokenizer fixtures, 40 tensor maps and 40 actual single-thread WASM probes against frozen training arithmetic. This is numerical parity, not correction quality.

Calibration uses the faster local Python CPU ONNX adapter, checked against the same fixed WASM/Torch probes. Final quality checks use the shipping CPU/WASM path. Build-time Python sees bounded numeric tensors, never sends text to a service, and is not required by users installing the extension or native EXE.

Published candidates promote the tested ZIP/Windows CI EXE by digest. Native Windows x86/x64 proxy/helper checks, installer tests and actual Outlook device acceptance remain distinct evidence. Published RC4/RC5 browser and RC3/RC4 native comparison releases remain unchanged. Historical RC5 measurements are available in its [fixed release source](https://github.com/mrksrus/localcorrect-browser/blob/v1.0.0-rc.5/QUALITY.md).
