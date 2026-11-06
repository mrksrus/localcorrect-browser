# Third-party notices and provenance

LocalCorrect program code is GPL-3.0-only (see LICENSE). The word-frequency
**data** are separately licensed CC BY-SA 4.0; the program license does not
relicense those data. New RC6 fine-tuned weight additions are offered under
CC BY-SA 4.0, with the pretrained base's MIT notice and the corpus attributions
retained. This is the project's selected release license for its additions, not
a claim that every use of training data creates a derivative work. Runtime and
source-data components retain their own terms.

## Trained contextual model

RC6 fine-tunes [hmBERT Mini, historic multilingual cased](https://huggingface.co/dbmdz/bert-mini-historic-multilingual-cased)
from Open Source at the Bayerische Staatsbibliothek, copyright 2020, under MIT.
The pinned upstream revision is
`4a0964c747fd6c06a20e8c0ca32bc27a23a6ad34`; the original safetensors SHA-256 is
`e291f5d44db7f17d3b75755feb02febbf4f3f2b137e9ac49ebb1fb00497dbda2`.
The four-layer pretrained encoder is adapted for sparse KEEP/single-word edit
decisions. It is not trained from scratch. Its historical newspaper/OCR source
domain differs from modern email. [MODEL.md](MODEL.md) describes the adaptation,
limitations, split roles and pending evaluation. The model directory retains the
upstream notice and the separate license for the new weight additions.

The public correction sources are:

- [ErAConD](https://github.com/yuanxun-yx/eracond), MIT, copyright 2022 YUAN Xun,
  revision `8401d3601f58170b55f0b1ca3773329c56b116f9`. Xun Yuan, Derek Pham,
  Sam Davidson and Zhou Yu, [ErAConD: Error Annotated Conversational Dialog Dataset
  for Grammatical Error Correction](https://aclanthology.org/2022.naacl-main.5/),
  NAACL 2022. Original/corrected utterances are aligned by conversation; the
  alternative corr2 annotation is excluded.
- [Falko](https://www.linguistik.hu-berlin.de/de/institut/professuren/korpuslinguistik/forschung/falko/zugang),
  corpus creators at Humboldt-Universitaet zu Berlin, CC BY 3.0, and
  [MERLIN](https://hdl.handle.net/20.500.12124/6), MERLIN project and creators,
  CC BY-SA 4.0. The selected tokenized texts and text-ID alignment come from
  [Adriane Boyd's WNUT 2018 release](https://github.com/adrianeboyd/boyd-wnut2018),
  repository revision `e7d3f9c8e5b7348c93cf9817efc35ae3af7783bc`. Credit Adriane
  Boyd for conversion/alignment and [Using Wikipedia Edits in Low Resource
  Grammatical Error Correction](https://aclanthology.org/W18-6111/), WNUT 2018.
  Component licenses are preserved separately; the Wikipedia data in that
  downloaded archive is not used by the learner-corpus preparation recipe.
- [WikiEdits-MultiGEC](https://huggingface.co/datasets/lang-uk/WikiEdits-MultiGEC),
  revision `e97c87e8caa49c12999cdf498252406a2115eae2`. Roman Kovalchuk, Mariana
  Romanyshyn and Petro Ivaniuk, [Introducing OmniGEC: A Silver Multilingual Dataset
  for Grammatical Error Correction](https://aclanthology.org/2025.unlp-1.17/),
  UNLP 2025. Its publisher dataset card declares MIT; the underlying English
  Wikipedia text retains CC BY-SA 4.0 and attribution to Wikipedia contributors.
  The private provenance records retain article, revision-diff and history URLs.
  The MIT card does not remove the underlying article terms or additional notices.
  Strict real revision pairs are mechanically filtered; train-only inverse-noise
  examples modify one word in weakly clean publisher corrections. Neither source
  is represented as individually verified grammar gold.

The [learner-corpus manifest](context-data-sources.json) and
[Wikipedia manifest](context-wikipedia-sources.json) record source URLs, revisions,
download hashes, selection rules and license evidence. The original Falko and
MERLIN source sites were inaccessible during the recorded verification; their
component terms are attributed to the pinned Boyd release. Raw and derived
learner/Wikipedia text remains outside the repository pending a separate privacy
and redistribution review. Recipes, hashes and notices are published; private
user documents and chats are not training data or public fixtures.

## Local neural inference runtime

[ONNX Runtime Web](https://github.com/microsoft/onnxruntime), Microsoft Corporation,
version 1.31.1, is MIT licensed and bundled for CPU/WASM inference. It is a runtime
component, not only a build dependency. The package lock pins its npm artifact;
the build pins the WASM bytes. The full Microsoft MIT notice and upstream
third-party notices are retained in `licenses/onnxruntime-LICENSE` and
`licenses/onnxruntime-ThirdPartyNotices.txt`. No model or runtime code is fetched
from a remote service during correction.

## Dictionaries: FrequencyWords / Hermit Dave

Attribution: Hermit Dave, FrequencyWords (2018 English and German lists),
https://github.com/hermitdave/FrequencyWords, revision
`525f9b560de45753a5ea01069454e72e9aa541c6`.
Upstream's README explicitly licenses **content CC BY-SA 4.0** and code MIT.
The README and MIT notice are preserved under licenses/. No upstream generator
code is incorporated. Source corpus is OpenSubtitles2018, OPUS:
https://opus.nlpl.eu/OpenSubtitles2018.php (as attributed by upstream).
See also P. Lison and J. Tiedemann (2016), OpenSubtitles2016: Extracting Large
Parallel Corpora from Movie and TV Subtitles, LREC 2016.

Changes: only lowercase alphabetic words of length 2–24, frequency >=150,
at most 30,000 words per language, retaining corpus order. Frequencies remain
corpus occurrence counts, not probabilities. The resulting dictionaries remain
CC BY-SA 4.0. Attribution/license: https://creativecommons.org/licenses/by-sa/4.0/.
Source URLs, exact hashes and resulting word counts: dictionary-sources.json.
Reproduce with `python scripts/dictionaries.py` (maintainer network operation).
No SymSpell frequency-dictionary data are used in the shipping engine. An English bigram research trial reused its separately attributed Google Books-derived file, produced no accepted coverage improvement, and is excluded from runtime assets. Frequency ranking is not a
spelling-validity inventory; a separate Hunspell layer below vetoes valid words.

## Mandatory offline lexical validation

Bundled `dictionary-en` 4.0.0 (SCOWL / en_US 2020.12.07; MIT/BSD and retained
component permissions) `dictionary-en-gb` 3.0.0 for British English, `dictionary-de` 3.0.0 and
`dictionary-de-at` 3.0.0 for Austrian German (igerman98, Björn Jacke;
GPL-2.0 OR GPL-3.0, **GPL-3.0 option selected**) retain unmodified aff/dic sources,
upstream readmes and complete notices in `packages/core/vendor`. German license
is not relabeled MIT; the full selected GPL-3.0 text is LICENSE. Full English
component redistribution texts are in licenses/dictionary-en-LICENSE and
licenses/dictionary-en-gb-LICENSE. Austrian German notices are retained in
licenses/dictionary-de-at-LICENSE under the selected GPL-3.0 option.

`nspell` 2.1.5, Titus Wormer, MIT, https://github.com/wooorm/nspell, and
`is-buffer` 2.0.5, Feross Aboukhadijeh, MIT,
https://github.com/feross/is-buffer, provide build-time offline affix expansion/validity.
Complete MIT notices and original source accompany both packages under vendor
and licenses. Generated ESM is self-contained; no installed dependency or fetch
is needed at runtime. nspell suggestions are **not** called. LocalCorrect performs its own symmetric
deletes, distance validation, frequency ranking and bounded exact lexical edit
probes. Merged EN US/GB and DE DE/AT membership inventories validate words and
those candidates. German entries originally capitalized in the expansion are
retained separately as casing evidence; this is not a complete POS tagger.

Pinned registry URLs, versions, npm integrity and aff/dic SHA256 hashes are in
lexicon-sources.json. Reproduce with `npm ci && node scripts/lexicons.mjs`.
All new assets/source/notices are shipped in both ZIPs and the portable core.

## Algorithm acknowledgement

LocalCorrect started as an original JavaScript reimplementation of Wolf Garbe's
[SymSpell symmetric-delete algorithm](https://github.com/wolfgarbe/SymSpell),
MIT upstream. It is not a GitHub fork and no upstream implementation or SymSpell
frequency dictionary was copied. The current compiler uses symmetric-delete keys
and optimal-string-alignment distance to reject competing common spellings.
Runtime uses compiled candidate data and a compact bounded lexical ambiguity lookup, with validity and protection gates.

## Recorded typo data

[codespell](https://github.com/codespell-project/codespell), dictionary.txt at
`b53e95197f7c799674c785028a182e2dfd1df881`, is CC BY-SA 3.0, with English Wikipedia
attribution retained in the vendored README. No codespell Python code is copied.
The source dictionary, README and full legalcode are in
`packages/core/vendor/typo-data`. `scripts/typos.mjs` filters single alphabetic
suggestions, excludes recognized original words, validates common targets and
rejects competing common one-edit interpretations. A narrow exception retains
adjacent swaps into eight common English function words, behind the same lexical,
name and quote protections. This exception can still be wrong in an unusual context. Typo labels remain
heuristics, not semantic proof or calibrated confidence. Derived codespell data
retain CC BY-SA 3.0.

[Litkey Corpus](https://linguistics.rub.de/litkeycorpus/), ISLRN 051-051-923-439-0,
is CC BY-SA 4.0. Authors: Ronja Laarmann-Quante, Katrin Ortmann, Anna Ehlert,
Simon Masloch, Doreen Scholz, Eva Belke and Stefanie Dipper. Citation: The Litkey
Corpus: A richly annotated longitudinal corpus of German texts written by primary
school children, Behavior Research Methods, 2019. The original domain is children's
writing, not adult email. We retain only isolated, lowercased alphabetic error pairs
with unambiguous observed targets and common adult dictionary targets. Runtime
compilation further checks distance, validity and ambiguity. No raw stories,
source file identifiers or correspondence are distributed. Complete legalcode,
modified pairs and provenance are in the same vendor directory. These derived
pairs retain CC BY-SA 4.0.

`typo-sources.json` records input/output hashes and inventory counts.
`scripts/source-typos.py --download` reproduces extraction from pinned source
bytes; `node scripts/typos.mjs` reproduces the compiled prior without reading test
data. The separately authored synthetic fixtures have their own provenance and
notices under `tests/scale-corpus/SOURCES.md`.

## Build/test tooling (not correction runtime)

esbuild 0.25.12 (MIT), https://github.com/evanw/esbuild.
Playwright 1.56.1 (Apache-2.0), https://github.com/microsoft/playwright.
Locked dependency sources/versions are in package-lock.json. These build tools
are not runtime dependencies. Generated bundles contain LocalCorrect source,
derived validity inventories and the separately credited ONNX Runtime Web adapter;
validator source is retained under vendor.
No remotely loaded code
is used by the extension.

## Protective vocabulary

[CSpell dictionaries](https://github.com/streetsidesoftware/cspell-dicts), Street Side Software and contributors, revision `f01d6cba4fe0161d337fc7339857783c3746e59c`, provide software terms and personal names. The selected software and people source files are MIT licensed. Each original package LICENSE and README is retained under `packages/core/vendor/protect-vocabulary`.

[Homebrew homebrew-core](https://github.com/Homebrew/homebrew-core), Homebrew contributors, revision `24bd80530c4270536ee7cecdf60c82e71b2f6aad`, provides 8,704 formula names extracted from the pinned Git tree. Only formula basenames are used, not formula implementation code. Its BSD-2-Clause notice is retained as `homebrew--LICENSE.txt` and copied to the normal license directory.

`scripts/protect-vocabulary.mjs` filters positive source terms, normalizes NFC and case, and adds conservative regular software plurals. These terms prevent speculative changes. Names protect titlecase input; software terms protect any case. This is preservation vocabulary, not a list of corrections or test answers. `protect-sources.json` and the vendored `sources.json` record every source URL, revision, byte count, transform and SHA-256. `python3 scripts/fetch-protect.py` restores exactly those pinned bytes. Ordinary builds use the vendored files offline.

`scripts/candidates.mjs` compiles the bounded one-edit candidate index from the already attributed frequency and validity inventories. `scripts/ambiguity-lexicon.mjs` compiles a shared finite-state ambiguity inventory from both languages and the protective sources. These transformations do not remove the source licenses. All inputs, generators and notices accompany the packages. No corpus gold is read by these compilers.

`scripts/inflection-eligibility.mjs` reuses the unchanged regional Hunspell affix rules with only source base lines present in the original frequency vocabulary at frequency150 or higher. Accepted expansions must also occur in the full selected-language inventory; existing frequency words are excluded. `inflection-sources.json` pins every dictionary, parser, compiler and manifest input. These positive eligibility forms inherit the original dictionary notices and never authorize a correction without complete runtime uniqueness and the ordinary protection gates.
