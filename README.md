# LocalCorrect — 1.0.0-rc.1

A manual, local-only typo corrector for English and German. Open the toolbar
popup, choose text language and **Conservative** or **Normal**, and click
**Correct**. Nonempty selections within a supported field are corrected; with
no selection, the focused field is used. **Undo** reverts the last correction
in that tab only if its snapshot is still current. Review changes before sending.
This is a release candidate, not a production-quality or perfect proofreader.

## Support and boundaries

- Chromium/Chrome 120+ MV3 and Firefox 140+ MV3 builds. Chrome DOM and unpacked
  extension paths are tested locally with Chromium. Firefox packaging is checked
  statically; a real Firefox install/signing review is still needed.
- Supports text/search inputs, textareas, and contenteditable with ordinary
  inline markup and paragraphs. Inline elements are retained; text replacements
  spanning inline nodes distribute replacement characters across those nodes.
- Password/email/URL/number/date/etc. inputs, disabled/read-only fields,
  embedded rich content (images/tables/widgets), browser-internal pages, extension
  stores, inaccessible frames, and shadow-DOM editors are **not supported**.
  Only the active top-level document is targeted. No fallback replaces rich HTML.
- Quoted lines (`>`), recognized reply-header tails and `--` signature tails
  are left alone. Known quote/signature DOM containers and links/code are skipped.
  Other signature layouts, names and identifiers cannot be reliably recognized:
  select only the new prose when in doubt. English unknown titlecase tokens are
  protected even at selection start. German titlecase correction needs a preceding
  determiner/possessive and a lexically accepted capitalized candidate; a narrow
  high-frequency transposition rule also handles initial formal German requests
  followed by an infinitive and “Sie”. A sentence boundary alone is not evidence.
  This is a
  heuristic, not reliable name or part-of-speech recognition.
- Preserves original whitespace, case pattern, emails, URLs, numbers and common
  identifiers and dotted filenames. Partial-token selections at either boundary
  are rejected without edits, including across inline nodes/combining marks.
  Does not rewrite style/grammar, split/join words, or correct known
  dictionary words used in the wrong context. Corpus data contain noise, names
  and subtitle vocabulary. Conservative/Normal are heuristic ambiguity and
  frequency gates, **not calibrated confidence levels**. False corrections and
  missed typos remain possible in either mode.
- Maximum 20,000 UTF-16 units and 3,000 word tokens per operation, bounded word
  lengths and candidate budgets. Select a smaller passage on a limit error.
  First correction loads a build-time affix-expanded lexicon and builds a local index;
  this synchronous work can cause a noticeable pause and uses additional memory.
- Custom editors/frameworks can reject synthetic input events. Test on a harmless
  draft first. Undo refuses changed DOM/text; it is not a general editor history.
- Status counts replacements, not corrected characters. “Left unchanged” counts
  tokens skipped by protection, short-word, name, ambiguity or candidate gates;
  it is not a total count of all unchanged or misspelled words. Dictionary-known
  tokens are unchanged but not necessarily included in that skip count.

## Install unsigned test packages

`dist/localcorrect-chrome-1.0.0-rc.1.zip`: unzip, open `chrome://extensions`, enable
Developer mode, **Load unpacked**, select the extracted folder. Enable file URL
access explicitly if testing local files. A ZIP is not a Chrome Web Store install.

`dist/localcorrect-firefox-1.0.0-rc.1.zip`: unsigned development archive. In standard
Firefox use `about:debugging` → This Firefox → Load Temporary Add-on → manifest.json
from the extracted folder. Temporary installs disappear after restart. Normal
permanent installation requires Mozilla signing/distribution; this project does
not claim the unsigned ZIP installs permanently in release Firefox.

The numeric manifest version is `0.9.0.1` for this prerelease (Chrome additionally
shows `version_name: 1.0.0-rc.1`); final 1.0.0 is deliberately not released.

## Privacy and permissions

No telemetry, analytics, cloud API, LLM, correction network service or logging of
text. Both dictionaries and executable code ship in each ZIP. `activeTab` and
`scripting` are requested only to perform an explicit toolbar action; no permanent
all-sites/content-script registration or background monitoring. Text stays in the
current browser tab and its extension isolated world. One undo snapshot is held
in that tab's memory until overwritten/navigation. Interface/language/mode choices
are saved in extension localStorage; document text is not stored there. The host
website and browser can independently send data; LocalCorrect does not control
that. No claims are made about other extensions or the host editor's privacy.

## Develop / verify

Node 22+, npm, Python 3 (for ZIP/reproducible data). `npm ci`, then `npm run check`.
The DOM tests use `/usr/bin/chromium` when present, otherwise Playwright Chromium:
`npx playwright install chromium`. Tests use only synthetic local fixtures.
`npm run build` emits both ZIPs and unpacked folders in build/. CI runs the same
checks. The extension smoke test loads the shipping unpacked package and verifies
its UI/resources/errors. Its synthetic end-to-end injection harness adds a
**test-only** fixture-origin host grant to substitute for a headless toolbar
activeTab gesture; that grant is never shipped. A real toolbar permission gesture
and Firefox behavior still require manual testing. Maintainer-only dictionary
refresh: `python scripts/dictionaries.py`.
Build/test dependencies are not required at runtime.

Portable core is `packages/core`, package `@localcorrect/core`:

```js
import {createCorrector} from '@localcorrect/core';
const corrector = createCorrector({en: enDictionaryText, de: deDictionaryText});
const result = corrector.correct('a seperate example', {
  language: 'en', mode: 'balanced' // or 'conservative'
});
// {text, edits: [{offset, length, replacement, original}], skipped}
```

The adapter supplies frequency dictionary strings. Broad EN/DE spelling-validity
lexicons are bundled/imported by default; callers (including Outlook) do not need
new arguments or fetches. Missing assets fail closed rather than reverting to
frequency-only correction. Rebuild lexical assets with `npm ci && node scripts/lexicons.mjs`.
The synchronous core has no DOM/fetch
or storage dependency. Offsets and lengths refer to UTF-16 positions in the
**original** text. Edits are sorted, non-overlapping; everything outside their
spans is preserved exactly. See THIRD_PARTY.md for algorithm and data provenance.
Program and selected German lexicon license: GPL-3.0. Frequency data: CC BY-SA 4.0.
English lexicon/component notices: MIT/BSD; nspell/is-buffer: MIT. See THIRD_PARTY.md.
