# RC6 contextual edit model

RC6 adds a trained contextual edit tagger after LocalCorrect's existing static
spelling stage. The intended behavior is conservative single-word correction in
English and German. It is not a sentence generator, a general grammar corrector
or a promise to understand a writer's meaning. Leaving an uncertain error unchanged
takes priority over making an unwanted edit.

The frozen candidate adds limited partial corrections. The independent synthetic
audit preserves zero unwanted edits but has no coverage gain over RC5. See
[QUALITY.md](QUALITY.md) for separate known, fresh and real-learner results and
measured CPU/RAM. This is an experimental candidate with substantial misses.

## Architecture and inference

The base encoder is [hmBERT Mini, historic multilingual cased](https://huggingface.co/dbmdz/bert-mini-historic-multilingual-cased),
from Open Source at the Bayerische Staatsbibliothek. Its pinned revision is
`4a0964c747fd6c06a20e8c0ca32bc27a23a6ad34`. The original pretrained weights are
MIT licensed, with safetensors SHA-256
`e291f5d44db7f17d3b75755feb02febbf4f3f2b137e9ac49ebb1fb00497dbda2`.
The model has four encoder layers and a hidden width of 256. It was pretrained
on historical multilingual newspaper/OCR material, which differs from modern
email and does not by itself establish correction ability.

LocalCorrect fine-tunes that encoder and a sparse edit head on correction pairs.
It does not train the encoder from scratch. The head chooses KEEP or a permitted
single-word replacement. Action vocabulary and support counts are mined from
training data only, with a bounded shared English/German inventory. The current
mining pass retains 72 English and 1,128 German replacements; reserving language
shares does not create English actions without training support. An input
trigger has at most eight replacements plus KEEP. Unsupported edits are masked
out of the training objective rather than recast as supported corrections.

Cased WordPiece input preserves accents and uses chunks of at most 128 pieces.
Chunks stop at sentence punctuation or a newline, or when the length limit is
reached. The model therefore has limited context and no document-wide reasoning.
It cannot insert/delete words, change punctuation, reorder phrases or generate a
free-form rewrite.

The browser uses the bundled ONNX Runtime Web 1.31.1 CPU/WASM backend, with one
inference thread and no worker proxy. The current staged FP32 ONNX export is
47,246,299 bytes, SHA-256
`899628b5f9ab75a075f158ffeadc9e30aea36e5f03e9c24facb11e87241e9e59`. File
size is not runtime RAM. The release targets roughly one second for a warm
1,000-word email on a CPU from around 2020 and roughly 1 GB as an upper runtime
allowance. The measured Node reference meets these targets on the development laptop;
browser-wide and actual Windows/Outlook behavior are separate measurements.

The static spelling stage runs first. Context scores refer to the unchanged
original input; accepted contextual edits cannot overlap static edits or protected
spans. A separate action policy requires sufficient training support and calibrated
KEEP-margin, competing-action gap and score thresholds. A missing, disabled or
mismatched policy abstains. Calibration is empirical and does not turn a softmax
score into a universal probability that an edit is safe.

## Training data and limits

The frozen RC6 training input has 21,328 rows:

| Component | Rows | Role |
|---|---:|---|
| ErAConD, Falko and MERLIN learner-corpus pairs | 19,024 | Public human-written correction pairs |
| Strict WikiEdits-MultiGEC revision pairs | 39 | Mechanically selected real revision pairs |
| WikiEdits inverse-noise pairs | 2,265 | Synthetic train-only supervision from weakly clean references |

Training JSONL SHA-256:
`d2e0710c44caddb91671366b4b913b8ed06d692d3b1b997e708ca5c8734bcbb8`.

Learner corrections contain capitalization, punctuation, lexical and fluency
changes beyond the supported action space. They are not a direct sample of adult
work email. Wikipedia revisions contain factual, stylistic and entity changes;
the strict real-pair filter accepts only complete paragraphs whose changes pass
the declared minimal-edit and protection rules. Mechanical filtering does not
certify grammatical correctness or semantic equivalence.

Inverse-noise training starts with whole publisher correction references from
articles assigned to TRAIN. They are explicitly labeled weakly clean, not verified
error-free. One lowercase token is mutated within one of ten fixed families:
`a/an`, `is/are`, `was/were`, `has/have`, `does/do`, `from/form`, `their/there`,
`then/than`, `where/were` and `to/too`. Applying the inverse edit must reproduce the
reference exactly. Quotes, code/URLs/markup, parentheses, fragments, numbers and
negation are excluded by a mechanical screen. Deterministic hash selection caps
the addition at 30,000 pairs, six per reference and 4,000 per direction. Actual
yield is lower, and some directions have no retained examples. A mutation can
occasionally remain valid or inherit a reference error; this is noisy training
supervision, never evaluation gold.

The RC6 recipe balances English/German training batches, with 3,000 edit-training
updates followed by 200 KEEP-focused updates on two local CPU threads. It uses
batch size eight, seed 81173, AdamW weight decay 0.01, encoder learning rate
0.00003 and head learning rate 0.001. A 100-update warmup precedes linear learning
rate decay to 10% by the end of the 3,200 updates. Corrected-side identity examples
teach preservation. No calibration,
test or fresh-audit labels enter gradient training. The completed run took
609.18 seconds and peaked at 986,644 KiB training RSS. See
[the training receipt](tests/context-results/training-v2.json). This is training
RAM, separate from inference RAM. Exact retraining bytes are not guaranteed.

## Split roles and evaluation status

Conversations or original document IDs determine learner-corpus splits. Wikipedia
uses canonical article IDs, so revisions and title changes of one article stay in
one split. A fixed SHA-256 assignment gives approximately 80/10/10 train,
calibration and test partitions. Normalized input and corrected text share a
duplicate namespace; cross-split collisions are removed conservatively. The
original learner split bytes are preserved when adding Wiki rows.

| Input | Purpose | RC6 status |
|---|---|---|
| 21,328 training pairs | Mine action vocabulary and fit weights | Frozen input; completed 3,200 updates |
| 2,191 calibration pairs and identity controls | Choose action thresholds and examine preservation | 13 actions enabled; calibration only |
| 3,200 held-out real pairs | Evaluate the frozen model and policy | First test complete; 21 supported additional partial edits in separate semantic audits |
| 400 separate English synthetic development cases | Additional threshold support and counterexamples | Known calibration; 9 wanted, 0 unwanted, 191 misses |
| 5,600 known synthetic regression documents | Check previously exposed behavior and calibration negatives | Known data, not fresh evidence |
| New sealed 200-document synthetic audit | Independent check after final model/policy freeze | Sealed before freeze; 9 wanted, 0 unwanted, 107 misses, equal to RC5 |

The sealed audit is identified by SHA-256
`e7b3a32a81d018621e516b607472a738466e0bf69bdb74303932ebb85eb44cb6`.
There are no synthetic additions to the real calibration or test split files.
The separate 400-case synthetic development set supplies additional policy
calibration, with at least eight positive documents and three surviving edits
when two independent human calibration documents are unavailable. All inputs
supply negative evidence. Each action threshold exceeds its maximum observed
negative margin by 0.5, with minimum margin 2 and minimum softmax score 0.9.
These are empirical thresholds, not safety guarantees.
Mechanical duplicate checks are distinct from inspecting or evaluating held-out
quality text. Once an audit is evaluated, it becomes known regression data for
later development. Results must report wanted edits, unwanted edits, misses,
unchanged-text preservation and exact whole-document corrections separately.

The 99% objective refers to precision among edits actually made, not recovery of
99% of errors. Zero observed unwanted edits is the primary acceptance goal, not a
population guarantee. CPU measurements must distinguish cold model loading from
warm inference and identify hardware, complete pipeline latency and peak RAM.

## Local adapter and identity contract

`createCorrector(...).correct()` remains synchronous. Without `contextScores`, it
runs the static stage. The asynchronous browser adapter and Node reference encode
the exact input, run local inference, then supply token-indexed logits to the core.
Passing `contextual: false` explicitly disables contextual edits.

The sparse ONNX contract uses `input_ids`, `attention_mask`, `word_positions` and
`candidate_ids` as int64, and `candidate_mask` as float32. Outputs are finite
float32 logits with dimensions `[batch, selected_words, 9]`. Token indices and
accepted edit offsets map to the original input's UTF-16 spans. Invalid shapes,
non-finite scores and mismatched identities fail closed.

`contextIdentity()` exposes the ONNX SHA-256/size and raw metadata SHA-256.
Metadata pins the vocabulary, tokenizer settings, action rows and candidate
ordering. The acceptance policy must match both model and metadata hashes.
The predictor rejects a supplied metadata file that differs from the embedded
encoder, and the build verifies the raw metadata against the embedded object.
Runtime adapters recompute scores from the captured original input and selected
language. Scores have no external trust boundary that permits a page to supply
them. Model and metadata identities bind action mapping and numerical inference.

Only explicit correction reads the captured text into the extension background.
Text and inference buffers are operation-local; the model session is reused.
Content, selection, tab and window are checked again before applying edits.
Inference failure applies no corrections. The page retains one Undo snapshot.
See [SECURITY.md](SECURITY.md) for the complete local data flow and limits.

## Reproduction and publication

Source revisions, downloads, byte hashes, licenses and selection rules are pinned
in [context-data-sources.json](context-data-sources.json) and
[context-wikipedia-sources.json](context-wikipedia-sources.json). Preparation is
offline by default; `--download` fetches only the pinned public source files.
The recorded training environment was Linux with Python 3.14. Restore its
locked dependencies from official PyPI/PyTorch CPU wheels in a virtual environment.
Keep output directories outside the repository:

```sh
python3 -m venv /private/localcorrect/venv
. /private/localcorrect/venv/bin/activate
python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r context-requirements-lock.txt
python scripts/context-pretrained.py --download --output /private/localcorrect/pretrained
python scripts/context-data.py --download --output /private/localcorrect/corpora
python scripts/context-wikipedia.py --download --base /private/localcorrect/corpora --output /private/localcorrect/corpora-v2
python scripts/train-context.py --input /private/localcorrect/corpora-v2/train-v2.jsonl --mine-only --balance-languages --min-count 2 --max-actions 1200 --max-per-trigger 8 --output /private/localcorrect/actions.json --report /private/localcorrect/action-report.json
OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 python -u scripts/train-context-encoder.py --input /private/localcorrect/corpora-v2/train-v2.jsonl --actions /private/localcorrect/actions.json --pretrained /private/localcorrect/pretrained --output-dir /private/localcorrect/encoder --steps 3000 --keep-steps 200 --batch-size 8 --threads 2 --seed 81173 --balance-languages --warmup-steps 100 --decay-lr
```

The commands above give the exact flags and logical paths. The
[training receipt](tests/context-results/training-v2.json) records the seed,
sampling schedule, Torch version, upstream file hashes and exported model hash.
[context-requirements-lock.txt](context-requirements-lock.txt) records the full
training environment versions; [context-model-sources.json](context-model-sources.json)
records the raw metadata hash. Start from the pinned upstream
safetensors/configuration/vocabulary, not the earlier rejected scratch MLP or
masked-word research experiment. Python training dependencies are unnecessary
for end-user inference. No cloud training or submission of document text is used.

Raw and derived learner/Wikipedia text remains in private work directories.
Publish preparation/training source, download and artifact hashes, component
notices, synthetic evaluation fixtures and their provenance. Public availability
of a corpus is not a privacy clearance to republish every learner detail. Private
user documents and chat-derived examples are excluded from public fixtures and
training.

## Credits and licenses

LocalCorrect application code is GPL-3.0-only. The project offers its new RC6
fine-tuned weight additions under CC BY-SA 4.0, retaining the original hmBERT MIT
notice. This is a selected license for the project's additions, not a legal claim
about every possible training use. Source corpus licenses remain distinct:
ErAConD MIT, Falko CC BY 3.0, MERLIN CC BY-SA 4.0, and underlying English Wikipedia
text CC BY-SA 4.0. WikiEdits-MultiGEC's publisher card declares MIT without removing
underlying Wikipedia obligations. ONNX Runtime Web is MIT. Full attribution,
citations, evidence limits and notice locations are in
[THIRD_PARTY.md](THIRD_PARTY.md).
