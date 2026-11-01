# RC1 review-fix quality evidence

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
grant; it is not proof of a real toolbar permission gesture. Firefox runtime,
signing, remote CI and real editor compatibility remain unverified here.
