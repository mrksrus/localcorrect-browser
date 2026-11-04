# Local correction quality evidence

Synthetic local tests, not general accuracy or a guarantee against false changes.
The independent full-sentence corpus is retained verbatim in `tests/acceptance.json`.
It is deliberately separate from the original lowercase isolated-word corpus.

| Independent sentence cases | Before Normal | After Normal | Before Conservative | After Conservative |
|---|---:|---:|---:|---:|
| English exact typo fixes | 4/6 | 5/6 | 3/6 | 4/6 |
| German exact typo fixes | 2/6 | 6/6 | 2/6 | 6/6 |
| Required-safe preserved | 16/16 | 16/16 | 16/16 | 16/16 |
| Exploratory contextual/split sentence fixes | 0/2 | 0/2 | 0/2 | 0/2 |

Normal still abstains on ambiguous `adress`; Conservative additionally leaves
`recieved`. No split/join or contextual real-word correction was added. Ordinary
valid words `versendet` and `protections` now remain unchanged in both modes.
A separate validity regression evenly samples 400 frequency-absent lexical forms
per language (800 total), in each mode, including affix-expanded vocabulary.

Original isolated-word metrics, explicitly **not German sentence coverage**:
English Normal 18/21, Conservative 16/21; German 12/14 in both modes. The original
15 unchanged fixtures per language remain unchanged in each mode. The original
misses are retained rather than removed from the denominator.

## How correction is constrained

- Symmetric-delete candidate lookup, OSA validation, original edit spans and bounded
  work remain the correction algorithm. nspell is used at build time to expand
  licensed Hunspell lexical inputs; its suggestion engine is never used.
- Bundled expanded validity/casing inventories contain 166,081 EN and 566,925 DE
  forms (including capitalization variants, not distinct lemmas). They are separate
  from the 30,000/28,168 frequency-ranked candidates. They are not comprehensive
  language authorities: nspell implements a subset of Hunspell morphology and no
  dynamic arbitrary German compound validation is promised.
- Capitalized German candidates need a determiner/possessive context and a valid
  capitalized lexical form. A reduced frequency floor applies only to adjacent
  transpositions in that context. At sentence start, a narrow formal-request shape
  (infinitive + Sie) is required; position alone does not authorize a change.
  This is grammatical/casing gating, **not a statistical contextual model** or a
  perfect noun/name classifier. Titlecase nouns without this context can be missed.
- English unknown titlecase words are preserved even at sentence/selection start.
  Short-word exceptions require high-frequency adjacent transpositions, not forced
  replacements. Dotted filenames are protected.
- Partial-token selections are rejected at either end without expanding scope,
  including inline node joins and combining marks. Whole-token selections and
  complete fields remain supported. Undo refuses subsequent text/DOM changes.

## Reproduce

`npm run check` writes `test-results/core-quality.json`, `sentence-quality.json`,
`dom.json`, `extension.json`, and `packages.json`. `npm audit` checks the locked
build dependencies. `node scripts/lexicons.mjs` regenerates lexical assets from
exact npm inputs after `npm ci`; `lexicon-sources.json` pins source integrity,
aff/dic hashes, derived hashes and form counts. ZIP verification checks these.

The Chromium integration harness uses only synthetic text and a test-only host
grant; it is not proof of a real toolbar permission gesture. Mozilla signing and arbitrary production editor compatibility remain unverified.
The Firefox runtime check is documented below separately.

## RC2 synthetic hill climb

The separate corpus in `tests/hillclimb.json` was frozen before tuning. Development
cases guided explicit protection and context rules. Holdout cases were evaluated
after tuning; they are now public regression data, not a future unseen benchmark.
Each split contains 24 typo sentences and 22 unchanged controls. Each sentence has
one intended typo. All examples are synthetic and contain no personal messages.

| Split / mode | Exact corrections before | Exact corrections now | Controls preserved before | Controls preserved now |
|---|---:|---:|---:|---:|
| Development / Conservative | 14/24 | 17/24 | 17/22 | 22/22 |
| Development / Normal | 18/24 | 21/24 | 14/22 | 21/22 |
| Holdout / Conservative | 23/24 | 23/24 | 21/22 | 22/22 |
| Holdout / Normal | 24/24 | 24/24 | 18/22 | 22/22 |

Before means browser commit `c67cc4c8e3107084bff0606c00d08e1c7da58ba1`.
`npm run evaluate` reproduces current counts and individual outputs. The small
corpus cannot establish general accuracy. Normal still changes an intentionally
misspelled word inside ordinary double quotes on the development set. Misses
include ambiguous `adress` and some German noun forms. No contextual grammar,
negation repair, split/join or unrestricted semantic correction is claimed.

The expanded validity strings now use sorted offsets and exact binary search
instead of hundreds of thousands of Set entries. In the local Node comparison,
lexicon initialization fell from about 580 ms to 90 ms and peak process memory
from about 440 MiB to 353-378 MiB. All 733,006 positive memberships, 15,122 negative
queries and all 184 corpus/mode outputs matched the previous implementation.
Lookup cost increased by about 3 microseconds per token. These are local process
measurements, not phone benchmarks or a memory cap. Native Jint measurements and
Office acceptance limits are documented in the Outlook companion.

## Browser operations

Keyboard commands now share the same saved settings and correction path as the
popup. Target capture happens before asynchronous dictionary loading. Changed
text, focus, selection or replayed operation IDs are rejected without writes.
Synthetic Chromium tests exercise both these guards and same-origin iframe
correction/Undo, plus the shipping popup/background path. The Chromium integration
manifest adds a test-only localhost host grant; the shipped ZIP has no host grant.
Official Firefox 159.0.1 and geckodriver 0.37.1 passed the shipping extension
through temporary unsigned installation in a disposable profile with Internet
blocked by a test proxy. WebDriver browser-UI key actions invoked the registered
Alt+Shift+C / Alt+Shift+Z commands with the original shipped activeTab permissions.
The checks cover whole textarea correction, Undo, saved German preferences,
contenteditable, focused same-origin iframe, password refusal, and saving/resetting
custom shortcuts through the shipped options UI. There was no
direct extension-command emission or test-only site grant in this Firefox check.
WebDriver content-context actions did not invoke browser shortcuts; the test
therefore uses the documented UI automation context. This does not test physical
keyboard layout, desktop shortcut conflicts or every website.

Run after a completed build, with no concurrent rebuild:

```sh
LOCALCORRECT_FIREFOX_BINARY=/path/to/firefox GECKODRIVER_BINARY=/path/to/geckodriver python3 tests/firefox.py
```

The script records the exact ZIP hash in `test-results/firefox.json`, installs a
CRC-checked snapshot and terminates its own browser/driver afterward. Its
`--allow-system-access` flag applies only to the disposable automation instance,
as described in [Mozilla's geckodriver flags documentation](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html).
It does not modify the owner's browser profile or grant the extension extra rights.
