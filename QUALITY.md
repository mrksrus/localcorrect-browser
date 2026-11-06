# RC7 language selection: quality and limits

RC7 adds a saved mixed-language vocabulary setting beside the existing English/German text-language selector. With the checkbox enabled, the spelling stage preserves words from both languages. With it disabled, lexical validity, competing-spelling checks and additional typo priors use the selected language. Shared names/software, quotations and literal-syntax protections remain. Old settings retain mixed vocabulary.

The 47,246,299-byte ONNX model, tokenizer/action metadata and 13-action neural acceptance policy are byte-identical to RC6. This release changes the spelling policy and UI; it does not retrain or expand the neural model's grammatical operations.

## Complete known synthetic checks

The actual single-thread ONNX CPU/WASM path ran every document in both saved modes and both vocabulary scopes. Both modes produced the same counts.

| Vocabulary setting | Wanted edits | Unwanted edits | Missed edits | Exact documents | Clean controls preserved |
|---|---:|---:|---:|---:|---:|
| Mixed English/German, all 6,200 | 4,471 | 0 | 2,417 | 4,348/6,200 | 2,620/2,620 |
| Selected language only, all 6,200 | 4,588 | 0 | 2,300 | 4,426/6,200 | 2,620/2,620 |

Selected-language spelling adds 117 wanted edits and 78 completely corrected documents on these stored examples, with no observed unwanted edit. All gains occur in the older 5,600-document regression collection. The 400 English development cases remain 9 wanted, 0 unwanted and 191 missed. The original 200-case RC6 audit remains 9 wanted, 0 unwanted and 107 missed in both scopes.

**All 6,200 documents are now known regression/calibration data.** Older collections reuse templates, and these results must not be presented as a random estimate of real email performance. RC7 has no new blinded generalization audit. The RC6 audit was fresh only at its first evaluation; its original freeze/results are preserved under [tests/language-results](tests/language-results), with the [fixed RC6 report](https://github.com/mrksrus/localcorrect-browser/blob/v1.0.0-rc.6/QUALITY.md) also available.

Exactness compares the complete output with the minimal reference. It includes unchanged clean controls; it is not the fraction of error-containing documents completely corrected. Wanted, unwanted and missed edits are separate counts. A wrong replacement is both unwanted and a miss. Zero unwanted edits on finite stored tests is not a population guarantee.

## What language selection does not solve

English alternatives can still prevent an English correction, and German alternatives can still prevent a German correction. A selected language does not establish author intent. The neural model still has only 13 enabled single-word replacement actions, a maximum context of 128 WordPieces, and no insertion, deletion, punctuation or phrase-reordering operation. Broad sentence correction remains limited. The language setting produces a modest benefit, not a large grammar improvement.

The separate historical 3,200-pair real-learner audit supported 21 additional partial neural repairs under RC6, mostly capitalization and three German dative-plural repairs. It is historical RC6 evidence and has not been rerun as a new selected-language-only quality claim. Its original strict-reference counts and supplemental semantic review remain available in the fixed RC6 reports. No raw learner or personal chat text is published.

## Provenance and runtime cost

Scoped ambiguity automata are compiled from the complete selected English or German Hunspell inventory plus the same shared positive software/people inventories. They add about 2.6 MB of decoded tables if both selected scopes are used. The typo overlay stores only 995 additional entries, about 29 KiB of source text, over the unchanged 769,126 mixed-language priors. The compiler verifies every inherited row is identical. Neither compiler reads documents, test gold or model output.

On the development Intel i5-1038NG7, four cores/eight threads and DDR4 RAM, the complete Node CPU/WASM reference measured:

- Mixed vocabulary: about 306–351 ms warm for the 1,000-word English fixtures, and 68–85 ms for German; peak whole-process RSS about 574 MiB.
- Selected-language vocabulary: about 303–337 ms warm for English, and 68–84 ms for German; peak about 602 MiB.
- Model-session construction: about 764–780 ms, with first static-table initialization additionally included in the first correction.

These measurements ran while another local validation process was active. Raw timings, CPU time, fixture identities and memory are in [benchmarks/rc7-node-mixed.json](benchmarks/rc7-node-mixed.json) and [benchmarks/rc7-node-single.json](benchmarks/rc7-node-single.json). The content-dependent policy skips independent chunks without enabled neural triggers; these are observed fixture results, not a universal latency promise. Node RSS is not browser-wide or Outlook-host memory. The native installer has its own helper measurements and acceptance limits.

## Validation and promotion

`npm run check` covers the complete frozen core/gold inventories, all 6,200 documents in both scopes/modes, exact output reconstruction, core safety, browser DOM and email DOM, actual Chrome/Firefox CPU/WASM execution, tokenizer/tensor/logit parity and package/source/license integrity. The dedicated actual Firefox shortcut harness also covers scope persistence, language/locale independence, both scope behaviors and Undo. Independent review reproduced both scoped automata and checked overlay provenance, cache isolation and native/browser boolean propagation.

Native CI compares all 6,622 original mixed cases plus 222 selected-language cases through the .NET engine and both Windows proxy bitnesses. Published releases promote the tested ZIP/CI EXE by digest. Passing hosted tests does not certify physical Outlook COM loading, formatting, installation or Undo. Previous published releases stay fixed.
