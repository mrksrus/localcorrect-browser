# Synthetic scale corpus, authoring receipt

This directory was authored without reading the correction engine, existing gold fixtures or evaluation results. Only the existing evaluator's data schema was inspected. No engine was run. No model endpoint, private correspondence or personal chat was used.

The frozen dataset has 5,000 invented documents, 2,500 English and 2,500 German. There are 3,000 correction documents and 2,000 unchanged controls. Formats are 2,000 complete emails, 2,000 multi-paragraph notes and 1,000 short messages. A subset of 100 emails contains approximately 1,000 words each. Correction documents contain one to five explicit edits. Offsets and lengths use UTF-16 code units, matching JavaScript string indexing.

Every corrected word comes from an individually authored sentence in `frames.tsv`. These 345 sentence frames cover ordinary adult arrangements, work, travel and household matters. The remainder of each document comes from original invented openings, paragraphs and closings. The long email paragraphs concern a community workshop. Documents combine templates and repeat sentence families. Some combinations are broadly related lists of practical matters rather than polished single-topic correspondence.

This is a scale and regression corpus. It is not a collection of 5,000 independently written real messages, a representative sample of chat usage, or proof of 99% real-world precision. The 60/40 correction/control mix is a chosen test mix, not an observed prevalence. Vocabulary and templates are limited. Missed corrections and unintended edits must be reported separately. Public-source pairs may also occur in a runtime prior; fresh context does not make a memorised pair independent.

## Sources and selection

Source downloads are bounded, hash-checked, and recorded in `sources/download-manifest.json`. The official source evidence is saved beside the downloads. The raw Litkey archive stays in this private scratch directory. Do not vendor it or the authoring scratch extracts into the product repository.

* Codespell dictionary revision `b53e95197f7c799674c785028a182e2dfd1df881`, [dictionary](https://github.com/codespell-project/codespell/blob/b53e95197f7c799674c785028a182e2dfd1df881/codespell_lib/data/dictionary.txt) and [official README license/format](https://github.com/codespell-project/codespell/blob/b53e95197f7c799674c785028a182e2dfd1df881/README.rst). Dictionary data is CC BY-SA 3.0. No codespell Python implementation was copied.
* Litkey original aligned token archive, [official access and license page](https://linguistics.rub.de/litkeycorpus/access.html), [download](https://linguistics.rub.de/litkeycorpus/corpus/Litkey-csv.zip). HTTP Last-Modified was 2022-03-08. Archive SHA-256 is `6d8db45fa079c1dc6128e9e8db2d181c0fbcbb9d51693ebbc1ecb7785e2d649c`. Corpus data is CC BY-SA 4.0. Cite Laarmann-Quante, Ortmann, Ehlert, Masloch, Scholz, Belke and Dipper, 2019, “The Litkey Corpus: A richly annotated longitudinal corpus of German texts written by primary school children”, Behavior Research Methods.

Only manually selected isolated alphabetic typo/target pairs are retained from Litkey. No story sentence, child identifier, original file identifier, student demographic, correspondence or source name is copied into a frozen data file. Intended targets come from the authored adult sentence frames. Source provenance records only isolated spelling pairs and aggregate occurrence counts. The public source remains children's handwriting-derived narratives, which differ from adult keyboard errors and can have annotation imperfections.

The public pair whitelist is in `public-pairs.txt`. A whitelist entry is accepted only when the exact normalized typo/target relation exists in the downloaded source. Codespell alternatives, comma annotations, uncertain multi-candidate corrections and casing-only changes are rejected. Where necessary, the spelling's initial case is adapted to its sentence frame, and that change is explicitly recorded. Some whitelist proposals are rejected; the frozen rejection receipt explains why.

Controlled mutations use deletion, adjacent transposition, repeated letters or one neighbouring keyboard key. They target the individually authored adult vocabulary. Their labels explicitly say `controlled-mutation`; they are not represented as observed human errors. The neighbour mapping is an intentionally limited QWERTZ-like pattern, not a population model of all keyboard layouts.

A source-target vocabulary veto rejects known real-word substitutions. Manual review also rejected conspicuous valid forms and names, including “booing”, “Einlauf”, “Kosen”, “Koten”, “Kühe”, “Garen”, “Flache”, “Grind”, “Jake”, “Jace”, “Persson” and “Peron”. This screening is conservative but cannot prove that every typo is absent from every rare vocabulary, dialect or possible proper name. Safe controls intentionally include valid foreign words, technical identifiers, dialect variants, informal register, fictional names, quotations and signatures.

## Splits and dependence

Families are assigned before document generation by a stable hash of normalized intended target. The split is global across languages, so Computer/computer, Information/information and Problem/problem stay together. A few obvious German derivational relations are grouped as well: Antwort/antworten, Arbeit/arbeiten and Versuch/versucht. The resulting 339 targeted families have no overlap between dev and holdout. The frozen documents are split 3,000 dev and 2,000 holdout, with exact language, format and correction/control proportions in each split.

The templates and topics are shared between splits. Valid contextual words may occur in both splits; the separation applies to intended typo-target families. Source dictionary overlap, repeated templates and the small vocabulary limit generalisation claims. An independently authored blind contextual set is still needed alongside this corpus. Once evaluated or inspected for tuning, a holdout result is no longer a fresh blind estimate for a later candidate.

## Reproduction and validation

Run `python3 fetch_sources.py` if source files are missing; it checks the recorded byte limits and SHA-256 values and refuses changed source bytes. Run `python3 build.py` from this authoring directory. It reads only the pinned source bytes and the authored frame/paragraph files. Run `node validate.mjs` for a separate native JavaScript check of all 5,000 exact UTF-16 spans, reconstructed expected text, proportions, unique inputs, maximum lengths and disjoint targeted families. The build also performs its own Python validation.

Every document input is unique. Corpus creation includes 300 documents with a non-BMP character before a gold edit, exercising genuine UTF-16 indexing. These structural checks do not independently prove that all linguistic expectations are correct. The author reviewed the sentence-frame vocabulary, source pair selection and generated isolated pair list before freezing, without using engine output.

`frozen/dev.json` and `frozen/holdout.json` use the evaluator-compatible `{cases:[...]}` wrapper. Edits have `offset`, `length`, `original` and `replacement`; extra fields retain provenance. Per-case `source`, `pairFamilies`, `pairIds`, `longEmail`, `wordCount` and `safetyCategory` support separate reporting.

`frozen/public-source-pairs.json` is the only candidate source artifact intended for vendoring into a runtime prior. It has deidentified, manually selected word pairs, per-pair licenses and observed-pair evidence. It must remain attributed and independently filtered for the product's safety policy. `frozen/pair-pool.json` contains controlled mutations too and is test-authoring material, not a recommendation to add every pair to inference.

## Licensing and publication boundary

The combined synthetic fixture data is offered under CC BY-SA 4.0. Codespell-derived material retains its CC BY-SA 3.0 source notice; the combined adaptation uses the later compatible license with the same license elements. Litkey-derived material retains CC BY-SA 4.0 and the citation above. Source-specific attribution and modification notices must travel with redistributed data. Original authoring text and controlled mutations are also offered under CC0 1.0 separately, so source-derived data can be kept distinct. The new authoring scripts are offered under MIT. No license is granted here for unrelated source code.

Vendor only the chosen frozen artifacts and their source/license notes. Do not publish the raw Litkey archive, raw children’s texts, temporary extracts or private directory paths. The raw downloadable archive is retained locally solely to reproduce isolated-pair extraction. `frozen/source-manifest.json` contains URLs and hashes, not original stories.
