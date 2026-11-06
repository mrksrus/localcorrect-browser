# Using LocalCorrect

Choose English or German in the toolbar. **Mixed-language vocabulary** is enabled by default and preserves words from both languages. Disable it for text written only in the selected language. This choice affects spelling vocabulary and competing-spelling checks; it does not translate text. Names, software terms, quotes and literal syntax remain protected. Interface language does not change text language.

Focus a text/search input, textarea or
ordinary contenteditable paragraph. Press Alt+Shift+C, or choose Correct in the
toolbar. A nonempty whole-word selection limits the correction; otherwise the
focused field is used. Alt+Shift+Z undoes the last operation if its text/DOM
snapshot is still current. The Firefox options page edits both shortcuts. Chrome
uses chrome://extensions/shortcuts. Language, mode and shortcut choices are saved
locally; document text is not.

Conservative and Normal currently share the same precision-first correction policy.
The saved mode values remain compatible with earlier releases. Neither is a
calibrated confidence level.

Quoted wording, including multiline and unfinished quotations, is preserved.
This intentionally leaves typos inside quotations. Quoted reply lines, recognized
reply headers and common signature tails are protected too. A P.S. or Nachtrag can
reopen prose after a recognized closing. Arbitrary signatures and names cannot
always be recognized. The static spelling stage preserves recognized words in either language when mixed-language vocabulary is enabled, or in the selected language when it is disabled. The contextual stage can consider an ordinary recognized word
through a permitted replacement, but only an enabled calibrated action may apply.

The existing spelling stage runs first. A fine-tuned BERT Mini edit tagger then
scores a bounded set of single-word replacements on the original text. It cannot
insert or delete words, reorder a sentence or perform a general rewrite. The
acceptance policy favors leaving uncertain text unchanged. Review the result;
neither its scores nor calibration promise perfect grammar or a universal error
rate. See [QUALITY.md](QUALITY.md) for measured quality, latency and limits.

Unedited spans, whitespace and rich formatting stay exact. Maximum selection is 20,000 UTF-16
units and 3,000 tokens. Whole-word boundaries are required. Password/email/URL/
numeric/date fields, protected pages, extension stores, inaccessible cross-origin
frames, shadow-DOM editors and complex embedded rich content are unsupported.
Ordinary inline markup is retained. Editors can reject synthetic input events;
check a harmless draft before relying on a new editor.

The extension ships its executable code, dictionaries, trained model and CPU/WASM
runtime. The first contextual operation loads the local model; later operations
reuse the model session. Download size is not runtime RAM, and host overhead are separate from model file size. See the measured cold/warm latency and memory limits in QUALITY.md.

It uses activeTab,
scripting and storage only. There is no permanent all-sites grant, content-script
monitor, correction service, telemetry or document logging. After an explicit
action, the captured text passes to the local extension background for inference.
Inference text and buffers are operation-local. The page keeps a pending capture
until completion or cancellation and one Undo snapshot until replaced, undone or
navigation. Focus, selection and content are rechecked before applying changes;
a changed field, tab or window aborts the operation. Inference failure applies no
corrections. The host website,
browser and other extensions have their own behavior outside this guarantee.

## Portable core

```js
import {createCorrector} from '@localcorrect/core';
const corrector = createCorrector({en: enDictionaryText, de: deDictionaryText});
const result = corrector.correct('a seperate example', {
  language: 'en', mixedLanguage: false, mode: 'conservative'
});
// result.text; result.edits = [{offset, length, original, replacement}]
```

All offsets refer to UTF-16 positions in the original input. Edits are sorted and
non-overlapping; spans outside edits remain exact. `prepare()` initializes static
validity inventories without reading a document. Missing mandatory assets fail
closed. The synchronous core has no DOM, network or storage dependency.

`correct()` remains synchronous and uses only the static spelling stage when no
context scores are supplied. Contextual inference belongs in an asynchronous
local adapter, as implemented by `extension/context-runtime.js` and the Node
reference in `scripts/context-reference.mjs`. The adapter uses
`encodeContext(text, language)` to create tensors and map scores to original token
indices, then passes the scores as `contextScores` to `correct()` for the exact
same input and language. `contextual: false` explicitly selects the static stage.

`contextIdentity()` reports the pinned ONNX hash/size and metadata hash. An adapter
must verify its model bytes and use the matching vocabulary/action metadata;
the acceptance policy must match both ONNX and metadata identity. Scores from
another input, language or model are not interchangeable. Do not retain document
text in an adapter cache. [MODEL.md](MODEL.md) documents the tensor contract and
the model's limits.

`mixedLanguage` must be a boolean. Omitted values retain the mixed English/German vocabulary for compatibility. `false` selects language-specific lexical validity, ambiguity and typo additions. Neural scores still use the chosen `language`; the model weights and action thresholds are unchanged.
