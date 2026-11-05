# LocalCorrect 1.0.0-rc.3

A manual, local-only typo corrector for English and German. Press **Alt+Shift+C**
in a focused editable field to correct it. **Alt+Shift+Z** undoes the last change.
Open the toolbar popup to select English or German, choose **Conservative** or
**Normal**, or use the **Correct** button. Use **Edit shortcuts** for editable
Firefox bindings. Chrome bindings are managed at `chrome://extensions/shortcuts`.
Nonempty selections within a supported field are corrected; with
no selection, the focused field is used. **Undo** reverts the last correction
in that tab only if its snapshot is still current. Review changes before sending.
This is a release candidate, not a production-quality or perfect proofreader.

## Support and boundaries

- Chromium/Chrome 120+ MV3 and Firefox 140+ MV3 builds. Chrome DOM and unpacked
  extension paths are tested locally with Chromium. Firefox runtime evidence and any remaining limitations are recorded in QUALITY.md.
  Mozilla signing and compatibility with arbitrary production editors are separate checks.
- Supports text/search inputs, textareas, and contenteditable with ordinary
  inline markup and paragraphs. Inline elements are retained; text replacements
  spanning inline nodes distribute replacement characters across those nodes.
- Password/email/URL/number/date/etc. inputs, disabled/read-only fields,
  embedded rich content (images/tables/widgets), browser-internal pages, extension
  stores, inaccessible frames, and shadow-DOM editors are **not supported**.
  The focused same-origin iframe can be targeted. Cross-origin frames remain
  inaccessible. No fallback replaces rich HTML.
- Quoted reply lines, recognized reply-header tails and signature tails are
  protected. Standard email closings protect following signature lines; an
  explicit P.S. or Nachtrag reopens new prose. Intentional literal quotations
  and quoted labels have narrow preservation rules. Ordinary quoted prose
  can still be corrected. Arbitrary signature layouts, names and language
  switches are not recognized perfectly.
- Capitalized names use context and honorific/greeting guards. English
  sentence-initial function words and calendar words have bounded correction
  rules. German noun contexts support ordinary inflected adjectives and
  contracted articles. Source casing and conservative compound checks help
  distinguish noun candidates from automatically capitalized verb forms.
  This is a heuristic, not reliable semantic or proper-name recognition.
- Exact lexical edit probes cover valid words absent from the frequency list.
  Ambiguity gates leave unresolved alternatives unchanged. Regional English
  and Austrian German inventories protect accepted variants. Code, paths,
  handles, flags and common technical identifiers remain protected.
- Preserves original whitespace, case pattern, emails, URLs, numbers and common
  identifiers and dotted filenames. Partial-token selections at either boundary
  are rejected without edits, including across inline nodes/combining marks.
  Case patterns are retained, with limited known German noun capitalization
  after article context. It does not rewrite style/grammar, split/join words,
  or correct known
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

`dist/localcorrect-chrome-1.0.0-rc.3.zip`: unzip, open `chrome://extensions`, enable
Developer mode, **Load unpacked**, select the extracted folder. Enable file URL
access explicitly if testing local files. A ZIP is not a Chrome Web Store install.

`dist/localcorrect-firefox-1.0.0-rc.3.zip`: unsigned development archive. In standard
Firefox use `about:debugging` → This Firefox → Load Temporary Add-on → manifest.json
from the extracted folder. Temporary installs disappear after restart. Normal
permanent installation requires Mozilla signing/distribution; this project does
not claim the unsigned ZIP installs permanently in release Firefox.

The numeric manifest version is `0.9.0.3` for this prerelease (Chrome additionally
shows `version_name: 1.0.0-rc.3`); final 1.0.0 is deliberately not released.

## Privacy and permissions

No telemetry, analytics, cloud API, LLM, correction network service or logging of
text. Both dictionaries and executable code ship in each ZIP. `activeTab` and
`scripting` let an explicit shortcut or toolbar action access the active tab.
`storage` keeps language, mode, interface and shortcut preferences. There is no
permanent all-sites/content-script registration or typing monitor. A background
handler waits for explicit extension commands and popup messages. Text stays in the
current browser tab and its extension isolated world. A captured operation and one
undo snapshot are held in that tab's memory until
overwritten/navigation. If focus, selection or content changes while resources
load, the operation refuses to apply stale results. Interface/language/mode choices
are saved in extension storage.local; document text is not stored there. The host
website and browser can independently send data; LocalCorrect does not control
that. No claims are made about other extensions or the host editor's privacy.

## Develop / verify

Node 22+, npm, Python 3 (for ZIP/reproducible data). `npm ci`, then `npm run check`.
The DOM tests use `/usr/bin/chromium` when present, otherwise Playwright Chromium:
`npx playwright install chromium`. Tests use only synthetic local fixtures.
`npm run build` emits both ZIPs and unpacked folders in build/. A GitHub Actions
workflow template is provided in `contrib/github-actions/`; it is not enabled by
this release. The extension smoke test loads the shipping unpacked package and verifies
its UI/resources/errors. Its synthetic end-to-end injection harness adds a
**test-only** fixture-origin host grant to substitute for a headless toolbar
activeTab gesture; that grant is never shipped. A real toolbar permission gesture
still requires manual testing on the target desktop. The optional Firefox test
uses official Firefox and geckodriver with a disposable profile, synthetic localhost
fields and Internet blocked by a test proxy. See QUALITY.md for its exact result. Maintainer-only dictionary
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

`npm run evaluate` reproduces the current 92-case development/holdout report in
`test-results/hillclimb.json`. These are synthetic examples, not personal messages.
The engine uses bundled dictionaries and explicit rules, not neural inference or training.

## Complete-email experiment

`tests/email-corpus` contains 200 additional frozen synthetic documents, including
80 complete emails and 60 other texts with multiple paragraphs. A separate
40-document audit was independently authored without reading the implementation
or the original cases. It was evaluated after the final source freeze.

The first 120 development cases guided changes. The original 80-case holdout was
then inspected and used for general safety fixes, so final results on that set
are post-validation results. It is not presented as an unseen final benchmark.
All original input/expected bytes and initial results are retained.

`npm run evaluate:emails -- --split all --label candidate` scores the original
200 documents; `--split audit` scores the separate audit. `--core /path/to/core`
compares a different core snapshot with the same gold. Reports include exact
document counts, wanted/missed/wrong edits, controls, timings and source/data
hashes. `npm run report:emails` builds an offline HTML comparison after baseline
and candidate reports have been generated. No server is required to open it.

`npm run check` includes all 200 documents in both modes through the Chromium
textarea adapter and Undo. Firefox's separate shipping test covers real browser
commands, settings and full-email examples. See QUALITY.md for exact results.
