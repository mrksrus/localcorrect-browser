# Independent blind spelling safety corpus

This corpus contains 100 newly authored synthetic documents. It supplements the 5,000-case benchmark and must be reported separately. The author did not inspect the correction engine, earlier fixtures, engine output or evaluation reports. The texts do not come from personal correspondence. Contacts use reserved example.com or .invalid domains, and personal identities are invented for these documents.

| Dimension | English | German | Total |
| --- | ---: | ---: | ---: |
| Documents | 50 | 50 | 100 |
| Unchanged controls | 35 | 35 | 70 |
| Correction documents | 15 | 15 | 30 |
| Gold spelling edits | 45 | 45 | 90 |
| Complete emails | 20 | 20 | 40 |
| Other multi-paragraph texts | 20 | 20 | 40 |
| Short texts | 10 | 10 | 20 |

Within each language, correction documents comprise six emails, six other multi-paragraph texts and three short texts. Each correction document has exactly three gold edits. Every complete email has a greeting, three body paragraphs and a closing with a signature. The controls and correction documents are independently written texts, with no document template expansion. Intentional regional wording, names, borrowed vocabulary, quotations, technical literals, abbreviations and negation are part of the preservation task.

There are 12 documents with CRLF line endings and eight with non-BMP characters. Some gold edits occur after non-BMP characters. Expected document lengths range from 12 to 844 whitespace-separated words. The longer email is a preservation control. This corpus alone does not establish performance for a 1,000-word email.

## Gold contract

`cases.json` has top-level `description` and `cases` fields. Each case includes `id`, `split`, `language`, `kind`, `format`, `input`, `expected` and `edits`. All split values are `blind`. The declared language is the main language of the document, not a prohibition on intentional mixed-language terms.

Every edit is an object with `offset`, `length`, `original` and `replacement`. Offsets and lengths count UTF-16 code units in the original input. Spans are sorted, bounded and non-overlapping. Applying the replacements to those original spans reconstructs `expected` exactly. Safe controls have no edits and byte-equivalent input and expected strings. Quoted text, code, identifiers, signatures, valid words and valid regional alternatives remain unchanged even when they are unusual. The gold permits spelling changes only.

Typos and replacements were selected by the author before any engine evaluation. All 90 gold edit contexts were manually checked for spelling intent and location. Static checks verified document counts, per-language and per-format balance, edit count, UTF-16 reconstruction, paragraph structure, line-ending preservation and non-BMP coverage. These checks do not run a correction model.

## Frozen evaluation

The JSON and this README were frozen before evaluation. `SHA256SUMS` records their exact SHA-256 hashes. Verify the hashes before running a candidate. Preserve these bytes and do not adjust the corpus in response to an engine result. The integrating agent must explicitly freeze the final model before inspecting case contents or evaluating this blind set. Keep any evaluation report outside this directory.

Report correct edits, wrong edits, missed gold edits, unchanged-control preservation and latency separately, with English and German breakdowns. Correction precision is correct actual edits divided by all actual edits; abstention reduces coverage. Exact expected-text equality is an additional strict document metric and does not replace the edit metrics. On this small sample, a perfect observed score does not establish a population guarantee of at least 99% correctness.

The corpus deliberately covers adult everyday, business and technical writing, but it is not a random sample of real correspondence. No engine evaluation was performed by the corpus author.
