# LocalCorrect

Fixes English and German typos in the text field you are typing in, in Firefox (and Chrome).
Everything runs on your computer: no account, no server, no text leaves the browser.

**Status: version 2.0.0, a from-scratch rewrite (November 2026).** Tested in headless Firefox
on a local test page. Not yet tested on real sites, in Chrome or from the toolbar popup.

**Alt+Shift+C** corrects the selected text, or the whole focused field when nothing is selected.
**Alt+Shift+Z** undoes it (Ctrl+Z works too). The toolbar button does the same and lets you
choose the text language: *Detect automatically* (default), *English* or *Deutsch*.
Change the shortcuts in `about:addons` → ⚙ → *Manage Extension Shortcuts*.

## What it fixes

- Misspelled words: `recieve` → `receive`, `Dnak` → `Dank`, `Empfnag` → `Empfang`
- Missing umlauts and ß: `fur` → `für`, `ueber` → `über`, `gross` → `groß`
- German noun capitals and English contractions: `haus` → `Haus`, `dont` → `don't`, `i` → `I`

It leaves alone: names, links, e-mail addresses, code, file names, numbers, acronyms,
command-line flags, quoted reply lines (`>`), quotes/links/code blocks in rich editors, and
words that are valid in the other language (`Meeting` in a German mail stays).

It does not fix grammar, or a real word used in the wrong place (`there`/`their`). When two
corrections fit equally well it takes the more common word, which is sometimes wrong
(`sehn` → `sein` instead of `sehen`): check before sending.

## Install (testing)

Build the packages with `npm run package` (or take them from a GitHub release when one exists),
unzip `dist/localcorrect-firefox-2.0.0.zip`, open `about:debugging` → *This Firefox* →
*Load Temporary Add-on* → pick `manifest.json`. A temporary add-on is gone after a restart;
a permanent install needs Mozilla signing. Chrome: unzip the Chrome package and use
*Load unpacked* in `chrome://extensions` with Developer mode on (built, not tested yet).

Works in text fields, text areas and rich-text (contenteditable) editors, including
same-origin frames. Webmail editors such as Gmail or Outlook on the web use contenteditable and
should work, but have not been tested yet. Not in password fields, browser pages (`about:`,
add-on stores), cross-origin frames or editors that draw their own text (Google Docs).

## How it works

`extension/corrector.js` is the whole engine, plain JavaScript with no browser dependency.
A word is fine if it is in the word list for the text language (German compounds are split
into known parts). Otherwise every word one edit away (a letter missing, extra, wrong or two
letters swapped) is looked up, and the most frequent one wins; swaps get a bonus because they
are the most common slip. Longer words also get two-edit candidates. The word lists contain
only words that the Hunspell dictionaries accept, with how often they occur in film subtitles.

## Develop

- `npm test`: engine tests (Node 20+)
- `npm run package`: builds `dist/localcorrect-{firefox,chrome}-<version>.zip`
- `python3 tests/firefox.py`: installs the Firefox package in a throwaway headless Firefox and
  presses the real shortcuts (needs `FIREFOX_BINARY` and `GECKODRIVER_BINARY`)
- `scripts/build-lexicon.py`: rebuilds the word lists (maintainers only, see the file)

Credits and licences: [THIRD_PARTY.md](THIRD_PARTY.md). Program licence: GPL-3.0.

## History and Outlook

Versions 1.0.0-rc.1 to rc.7 (precision gates and a BERT model) almost never corrected
anything and were replaced by this rewrite. They remain as git tags, releases and branches.
The [Outlook add-in](https://github.com/mrksrus/localcorrect-outlook) still builds against the
old `packages/core` at a pinned commit of this repository and has not been moved to version 2.
