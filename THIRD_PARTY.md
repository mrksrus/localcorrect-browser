# Third-party notices and provenance

LocalCorrect program code is GPL-3.0-only (see LICENSE). The word-frequency
**data** are separately licensed CC BY-SA 4.0; the program license does not
relicense those data. Both complete license texts are included in packages.

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
Locked dependency sources/versions are in package-lock.json. Build tool code is
not included as a runtime dependency. Generated bundles contain LocalCorrect
source and derived validity inventories; validator source is retained under vendor.
No remotely loaded code
is used by the extension.

## Protective vocabulary

[CSpell dictionaries](https://github.com/streetsidesoftware/cspell-dicts), Street Side Software and contributors, revision `f01d6cba4fe0161d337fc7339857783c3746e59c`, provide software terms and personal names. The selected software and people source files are MIT licensed. Each original package LICENSE and README is retained under `packages/core/vendor/protect-vocabulary`.

[Homebrew homebrew-core](https://github.com/Homebrew/homebrew-core), Homebrew contributors, revision `24bd80530c4270536ee7cecdf60c82e71b2f6aad`, provides 8,704 formula names extracted from the pinned Git tree. Only formula basenames are used, not formula implementation code. Its BSD-2-Clause notice is retained as `homebrew--LICENSE.txt` and copied to the normal license directory.

`scripts/protect-vocabulary.mjs` filters positive source terms, normalizes NFC and case, and adds conservative regular software plurals. These terms prevent speculative changes. Names protect titlecase input; software terms protect any case. This is preservation vocabulary, not a list of corrections or test answers. `protect-sources.json` and the vendored `sources.json` record every source URL, revision, byte count, transform and SHA-256. `python3 scripts/fetch-protect.py` restores exactly those pinned bytes. Ordinary builds use the vendored files offline.

`scripts/candidates.mjs` compiles the bounded one-edit candidate index from the already attributed frequency and validity inventories. `scripts/ambiguity-lexicon.mjs` compiles a shared finite-state ambiguity inventory from both languages and the protective sources. These transformations do not remove the source licenses. All inputs, generators and notices accompany the packages. No corpus gold is read by these compilers.

`scripts/inflection-eligibility.mjs` reuses the unchanged regional Hunspell affix rules with only source base lines present in the original frequency vocabulary at frequency150 or higher. Accepted expansions must also occur in the full selected-language inventory; existing frequency words are excluded. `inflection-sources.json` pins every dictionary, parser, compiler and manifest input. These positive eligibility forms inherit the original dictionary notices and never authorize a correction without complete runtime uniqueness and the ordinary protection gates.
