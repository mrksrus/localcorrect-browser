# LocalCorrect

Press a shortcut to correct English or German typos in a Firefox text field.
Everything runs locally. No account, server, cloud model or typing monitor is
required. The goal is useful corrections with as few unwanted edits as possible.
**An uncertain typo should stay unchanged.**

**Alt+Shift+C** corrects the selection, or the focused field when nothing is
selected. **Alt+Shift+Z** undoes the last correction. Both shortcuts are editable.
The toolbar also has a correction button and language selection.

[Download the experimental Firefox/Chrome builds and test results](https://github.com/mrksrus/localcorrect-browser/releases/tag/v1.0.0-rc.5).
For classic Outlook 2019, use the separate
[native Windows EXE add-in](https://github.com/mrksrus/localcorrect-outlook).
It does not use an Exchange/account manifest.

## What this can do

LocalCorrect fixes spelling slips, including many transpositions, doubled or
missing letters and common recorded misspellings. It preserves recognized words
in either language, quotations, reply/signature tails, links, identifiers and
unrelated formatting. It does not infer meaning, rewrite prose or reliably fix
grammar and real-word errors. Names and unfamiliar vocabulary remain difficult.
Missed typos and wrong replacements are separate quality measurements.

This is a release candidate. The 99% target means precision among edits actually
made, **not** correction of 99% of all errors. See [QUALITY.md](QUALITY.md) for
wanted/wrong/missed edit counts, fresh validation, latency and remaining gaps.
The public tests include 5,500 known regression documents and a separately authored
final 100-document RC5 audit first evaluated after the final policy freeze. They are reproducible
synthetic tests, not proof of real-world perfection. Browser RC4 and native Outlook
RC3 remain fixed comparison releases; subsequent candidates do not overwrite them.

## Install and use

Unzip the Firefox package, open `about:debugging`, choose **This Firefox**, then
**Load Temporary Add-on** and select its `manifest.json`. This unsigned temporary
installation disappears when Firefox restarts. Permanent installation in standard
Firefox still requires Mozilla signing.

For Chrome, unzip its package and choose **Load unpacked** at
`chrome://extensions` with Developer mode enabled.

Select English or German in the toolbar, focus an ordinary text field and press
the shortcut. Maximum input is 20,000 UTF-16 units and 3,000 words. Ordinary
contenteditable paragraphs and same-origin frames are supported, with guarded
Undo. Password fields, protected pages, inaccessible frames, shadow DOM and
complex embedded editors are excluded. See [USAGE.md](USAGE.md).

## Starting point and improvements

The starting algorithm was **[SymSpell by Wolf Garbe](https://github.com/wolfgarbe/SymSpell)**.
This repository is an original JavaScript implementation inspired by that
algorithm, not a direct GitHub fork of its C# code. Credit belongs to the original
author for symmetric-delete candidate lookup.

The current build compiles candidate indexes from bundled frequency/validity dictionaries,
[codespell](https://github.com/codespell-project/codespell) misspellings and isolated
[Litkey](https://linguistics.rub.de/litkeycorpus/) German error pairs. A compact shared lexical automaton checks competing English
and German interpretations at runtime. CSpell vocabulary and Homebrew formula names
protect names and technical terms. All lookups are bounded; uncertain cases stay
unchanged. Edits refer to spans in the original text. No document-derived state
survives a correction call.

The code and correction policy were written and revised with AI assistance, using
reproducible input/output comparisons, independent review and performance profiles.
**There is no neural model, gradient training, fine-tuning or manually sculpted
neural weight file.** The improvement loop adjusts software rules and compiled
data. Generating a large table with code does not create learned intelligence.
No user documents or private chats are included in the published tests.

## Data, credits and reproduction

- [5,000-case data and authoring notes](tests/scale-corpus/AUTHORING-NOTES.md),
  [source notices](tests/scale-corpus/SOURCES.md), the
  [earlier blind set](tests/scale-corpus/blind/README.md),
  [consumed first RC5 audit](tests/scale-corpus/rc5-blind/README.md), and
  [consumed second RC5 audit](tests/scale-corpus/rc5-blind2/README.md), and
  [final 100-document audit](tests/scale-corpus/rc5-final-blind/README.md).
- [Third-party credits and licenses](THIRD_PARTY.md), including SymSpell,
  FrequencyWords/Hermit Dave, the English/German spelling dictionaries,
  codespell, the Litkey authors, CSpell contributors and Homebrew contributors.
- `npm ci && npm run check` builds and tests the extension. Build dependencies
  are unnecessary at runtime. Node 22+, Python 3 and local Chromium are used.
- `node scripts/typos.mjs` rebuilds the static correction prior from vendored,
  attributed sources. `node scripts/candidates.mjs`,
  `node scripts/protect-vocabulary.mjs`, `node scripts/ambiguity-lexicon.mjs`
  and `node scripts/inflection-eligibility.mjs`
  rebuild the additional indexes. None reads test cases.
- `python3 scripts/source-typos.py --download` reproduces the isolated source
  subset from size/hash-pinned downloads. Raw Litkey stories are not published.
- `node tests/scale-evaluate.mjs --file tests/scale-corpus/dev.json --label dev`
  scores a chosen set. Use `--core /path/to/core` to compare another snapshot.
  The public holdout and blind files are now regression data for future work.

Program license: GPL-3.0-only. Reused data retain their separate licenses.
[Security](SECURITY.md). [Project decisions](PROJECT-PREFERENCES.md).
