# Third-party data and credits

- **Word frequencies**: [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave,
  OpenSubtitles 2018, revision `525f9b560de45753a5ea01069454e72e9aa541c6`. CC BY-SA 4.0
  (`licenses/CC-BY-SA-4.0.txt`, `licenses/FrequencyWords-LICENSE`). Only the counts of words
  accepted by Hunspell are kept, in `extension/data/*.lex`.
- **English Hunspell dictionary**: npm `dictionary-en` 4.0.0 (SCOWL / Kevin Atkinson et al.),
  `licenses/dictionary-en-LICENSE`. Used at build time to decide which words are valid.
- **German Hunspell dictionary**: npm `dictionary-de` 3.0.0 (igerman98, Björn Jacke), GPL-2.0/3.0,
  GPL-3.0 chosen; `licenses/dictionary-de-LICENSE`. Used at build time the same way.
- **spylls** (MIT), Victor Shepelev: Hunspell implementation used by `scripts/build-lexicon.py`.
  Not shipped.
- **Algorithm**: candidate generation by one/two edits, after Peter Norvig's
  "How to Write a Spelling Corrector" and Wolf Garbe's SymSpell. Original code.
