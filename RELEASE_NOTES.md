# 1.0.0-rc.6

Experimental local contextual correction, with a 47.25 MB trained hmBERT Mini edit tagger after the existing precision-first spelling engine. The model runs on CPU; no cloud, account, typing monitor or runtime download is needed.

The policy enables 13 supported actions. It adds nine wanted corrections on 400 known English grammar calibration examples. On 3,200 separate learner pairs, two independent reviews support 21 additional partial corrections. Whole-document exactness there remains unchanged. The new independent 200-document synthetic audit has nine wanted edits, zero unwanted edits and 107 misses, identical to RC5. This is limited progress, not general grammar coverage or a claim of 99% complete corrections.

The 5,600 known synthetic documents retain 4,453 wanted edits, zero unwanted edits and 2,119 misses. Quotations, names, variables and selected-text context have stronger preservation checks. Model/metadata/policy identities are bound together. Actual packaged Firefox and Chrome tests exercise a neural-only correction, Undo and stale-field guards.

On the development i5-1038NG7, whole Node CPU/WASM warm 1,000-word fixtures take about 65–321 ms, depending on language/content, at about 579 MiB peak process RSS. Browser and native host measurements are separate. See QUALITY.md and MODEL.md for data roles, exact hashes, limits and reproduction.

The Firefox ZIP is unsigned and loads temporarily through about:debugging. Standard permanent installation still requires Mozilla signing. Chrome uses Load unpacked. Existing published candidates are not replaced. The companion native Outlook RC5 is a separate experimental Windows EXE, with physical Outlook acceptance still unverified.
