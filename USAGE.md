# Using LocalCorrect

Choose English or German in the toolbar. Focus a text/search input, textarea or
ordinary contenteditable paragraph. Press Alt+Shift+C, or choose Correct in the
toolbar. A nonempty whole-word selection limits the correction; otherwise the
focused field is used. Alt+Shift+Z undoes the last operation if its text/DOM
snapshot is still current. The Firefox options page edits both shortcuts. Chrome
uses chrome://extensions/shortcuts. Language, mode and shortcut choices are saved
locally; document text is not.

Conservative and Normal currently share the same precision-first compiled policy.
The saved mode values remain compatible with earlier releases. Neither is a
calibrated confidence level.

Quoted wording, including multiline and unfinished quotations, is preserved.
This intentionally leaves typos inside quotations. Quoted reply lines, recognized
reply headers and common signature tails are protected too. A P.S. or Nachtrag can
reopen prose after a recognized closing. Arbitrary signatures and names cannot
always be recognized. Recognized words in either language are preserved even when
they could be typos in the selected language.

Edits retain whitespace and case pattern. There is no style rewrite, semantic
understanding or general grammar correction. Maximum selection is 20,000 UTF-16
units and 3,000 tokens. Whole-word boundaries are required. Password/email/URL/
numeric/date fields, protected pages, extension stores, inaccessible cross-origin
frames, shadow-DOM editors and complex embedded rich content are unsupported.
Ordinary inline markup is retained. Editors can reject synthetic input events;
check a harmless draft before relying on a new editor.

The extension ships its executable code and dictionaries. It uses activeTab,
scripting and storage only. There is no permanent all-sites grant, content-script
monitor, correction service, telemetry or document logging. Text and one Undo
snapshot remain in the active tab's memory until replaced or navigation. Focus,
selection and content are rechecked before applying changes. The host website,
browser and other extensions have their own behavior outside this guarantee.

## Portable core

```js
import {createCorrector} from '@localcorrect/core';
const corrector = createCorrector({en: enDictionaryText, de: deDictionaryText});
const result = corrector.correct('a seperate example', {
  language: 'en', mode: 'conservative'
});
// result.text; result.edits = [{offset, length, original, replacement}]
```

All offsets refer to UTF-16 positions in the original input. Edits are sorted and
non-overlapping; spans outside edits remain exact. `prepare()` initializes static
validity inventories without reading a document. Missing mandatory assets fail
closed. Runtime has no DOM, network or storage dependency.
