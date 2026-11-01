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
No SymSpell.FrequencyDictionary or Hunspell data are used; in particular we do
not mislabel German GPL Hunspell data as MIT.

## Algorithm acknowledgement

The original LocalCorrect implementation uses Wolf Garbe's SymSpell symmetric
-delete algorithm: https://github.com/wolfgarbe/SymSpell (MIT upstream). No code
or dictionaries from that repository were copied. It builds deletion indexes,
intersects deletion candidates, validates with optimal-string-alignment edit
distance, and ranks by distance/frequency. It is not a fixed replacement list.

## Build/test tooling (not correction runtime)

esbuild 0.25.12 (MIT), https://github.com/evanw/esbuild.
Playwright 1.56.1 (Apache-2.0), https://github.com/microsoft/playwright.
Locked dependency sources/versions are in package-lock.json. Build tool code is
not included as a runtime dependency. Generated bundles contain LocalCorrect
source only. No remotely loaded code is used by the extension.
