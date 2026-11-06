# LocalCorrect

Press a shortcut to correct English or German text in a Firefox text field.
Everything runs locally. No account, server, cloud model or typing monitor is
required. The goal is useful corrections with as few unwanted edits as possible.
**An uncertain typo should stay unchanged.**

**Alt+Shift+C** corrects the selection, or the focused field when nothing is
selected. **Alt+Shift+Z** undoes the last correction. Both shortcuts are editable.
The toolbar also has a correction button and language selection.

[Download experimental RC6 and its evidence](https://github.com/mrksrus/localcorrect-browser/releases/tag/v1.0.0-rc.6).
For classic Outlook 2019, use the separate
[native Windows EXE add-in](https://github.com/mrksrus/localcorrect-outlook).
It does not use an Exchange/account manifest.

## What this can do

LocalCorrect starts with its existing spelling engine, then uses a fine-tuned
BERT Mini edit tagger to consider a bounded set of single-word contextual repairs,
including some valid-word confusions and agreement errors. A separately calibrated
policy decides which proposed edits may be applied. It can leave errors unchanged
and can still make mistakes. It does not rewrite sentences or provide general
grammar correction.

Quotations, recognized reply/signature tails, links, identifiers and unrelated
formatting remain protected. Names and unfamiliar vocabulary remain difficult.
Recognized words are preserved by the static stage; the contextual stage can
change an ordinary valid word only through an enabled, calibrated replacement.
Missed corrections and wrong replacements are separate quality measurements.

This is a release candidate. The 99% target means precision among edits actually
made, **not** correction of 99% of all errors. See [QUALITY.md](QUALITY.md) for
wanted/wrong/missed edit counts, fresh validation, latency and remaining gaps.
RC6 uses 5,600 previously authored synthetic documents as known regression data.
They are reproducible tests, not fresh evidence or proof of real-world perfection.
The new 200-document audit was sealed until the RC6 model and correction policy
were frozen. It shows zero unwanted edits and no coverage gain over RC5. Browser RC4 and native Outlook
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

The static stage compiles candidate indexes from bundled frequency/validity dictionaries,
[codespell](https://github.com/codespell-project/codespell) misspellings and isolated
[Litkey](https://linguistics.rub.de/litkeycorpus/) German error pairs. A compact shared lexical automaton checks competing English
and German interpretations at runtime. CSpell vocabulary and Homebrew formula names
protect names and technical terms. All lookups are bounded; uncertain cases stay
unchanged. The trained contextual stage scores permitted replacements directly,
including candidates for valid words, using the original text. Edits refer to
spans in that original text and cannot overlap static edits. Model execution uses
the bundled ONNX Runtime Web CPU/WASM backend, without a remote model service.

The code and correction policy were written and revised with AI assistance, using
reproducible input/output comparisons, independent review and performance profiles.
RC6 fine-tunes an existing pretrained encoder on public correction pairs. Its
21,328 training rows include 19,024 learner-corpus pairs, 39 strictly filtered
Wikipedia revision pairs and 2,265 train-only inverse-noise pairs made from
weakly clean Wikipedia references. Those references are not certified error-free.
Calibration, held-out testing and the fresh audit have separate roles. See
[MODEL.md](MODEL.md) for the architecture, data, split rules, provenance and limits.
No private user documents or chats enter the training corpus or published tests.

Only an explicit correction sends the captured selection, or the focused field,
to the extension's local background for inference. Text is not logged, stored or
sent to a server. The field, selection, active tab and window are checked again
before applying edits. One Undo snapshot remains in the page's memory. See
[SECURITY.md](SECURITY.md) for the data flow and retention limits.

## Data, credits and reproduction

- [5,000-case data and authoring notes](tests/scale-corpus/AUTHORING-NOTES.md),
  [source notices](tests/scale-corpus/SOURCES.md), the
  [earlier blind set](tests/scale-corpus/blind/README.md),
  [consumed first RC5 audit](tests/scale-corpus/rc5-blind/README.md), and
  [consumed second RC5 audit](tests/scale-corpus/rc5-blind2/README.md), and
  [final 100-document audit](tests/scale-corpus/rc5-final-blind/README.md).
- [Third-party credits and licenses](THIRD_PARTY.md), including SymSpell,
  FrequencyWords/Hermit Dave, the English/German spelling dictionaries,
  codespell, the Litkey authors, CSpell contributors, Homebrew contributors,
  hmBERT, ONNX Runtime, ErAConD, Falko, MERLIN and Wikipedia contributors.
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
- [The model card](MODEL.md) describes the separate train-only action mining and
  fine-tuning recipes. Raw learner and Wikipedia text stays outside the repository;
  preparation scripts, source hashes, notices and synthetic test provenance are
  published instead.

Program license: GPL-3.0-only. New fine-tuned weight additions are offered under
CC BY-SA 4.0, with the pretrained base's MIT notice retained. Reused data and
runtime components retain their separate licenses.
[Security](SECURITY.md). [Project decisions](PROJECT-PREFERENCES.md).
