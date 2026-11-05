# Synthetic email and paragraph corpus

Version `email200-v1`, authored and frozen on 2026-11-05 before any baseline or candidate engine evaluation. All prose is newly authored synthetic material. It does not quote private correspondence, customer records, or external copyrighted sources. Names, organisations, references and correspondence are invented. Network examples use `example.com` or `.invalid` addresses.

The existing 92-case corpus in `tests/hillclimb.json` is unchanged. None of these 200 inputs is an exact duplicate of an input in that corpus.

| Split | Language | Correction | Unchanged control | Total |
| --- | --- | ---: | ---: | ---: |
| Development | English | 45 | 15 | 60 |
| Development | German | 45 | 15 | 60 |
| Holdout | English | 30 | 10 | 40 |
| Holdout | German | 30 | 10 | 40 |
| Total | Both | 150 | 50 | 200 |

The corpus contains 80 complete emails, 60 other multi-paragraph texts and 60 short cases. Every complete email has a greeting, three separate body paragraphs, and a closing with a signature. The emails include 20 unchanged controls. Every other text marked `paragraphs` has at least two paragraphs.

Each language contributes 40 emails, 30 paragraph texts and 30 short cases. Development contains 48 emails, 36 paragraph texts and 36 short cases. Holdout contains 32 emails, 24 paragraph texts and 24 short cases. Scenarios include support, billing, logistics, personal arrangements, technical work, community events, accessibility, archives and ordinary workplace correspondence. These are separate authored situations, not a repeated paragraph with substituted names.

## Gold construction

Clean drafts were written first with explicit inline annotations for intended spelling errors. A deterministic authoring script materialized the complete input, expected text, and gold edits. The author reviewed the intended word in its sentence before freezing the fixtures. No engine output or candidate dictionary lookup was used to choose or revise the drafts. Correction cases contain three or four independent spelling errors. There are 506 gold edits in total.

Edits cover omitted, doubled and transposed letters, sentence-initial spelling, German noun capitalization, missing umlauts, and `ß`. Difficult long words and compounds remain in the corpus even if a conservative spelling engine abstains. This is a spelling benchmark, not an instruction to rewrite grammar or infer the intended replacement for a valid but contextually suspicious word.

Unchanged controls include contractions, regional spellings, dialect, invented names, identifiers, code, URLs, email addresses, literal quotations and unusual signatures. Valid-word ambiguities stay unchanged. Text outside annotated gold spans stays byte-for-byte unchanged, including whitespace and punctuation. There are no gold edits inside a signature, quoted tail, URL, email address or inline code span.

Both splits include CRLF and astral Unicode characters to exercise offset handling. Newlines inside JSON string values remain part of the input and expected text.

## Schema and checks

Each JSON file contains metadata plus a `cases` array. Each case has `id`, `split`, `language`, `kind`, `format`, `scenario`, `input`, `expected`, and `edits`. `kind` is `correction` or `safe`; `format` is `email`, `paragraphs`, or `short`.

Every gold edit is `{ "offset": number, "length": number, "original": string, "replacement": string }`. Offsets and lengths count UTF-16 code units in the original input, matching JavaScript string indexing. Edits are sorted and do not overlap. Apply them from right to left. Unchanged controls have an empty edit array.

Before freezing, validation checked the exact count and split balance, duplicate inputs, minimum paragraph structure, at least three edits per correction case, spelling-only gold tokens, protected-span exclusion, preservation of all whitespace, and exact reconstruction of `expected` by applying the UTF-16 gold edits. These checks validate the fixture structure and annotations; they are not engine accuracy results.

## Evaluation boundary

Use `dev.json` for analysis and tuning. Do not inspect individual holdout examples or results until the candidate implementation has been frozen. Keep the fixture bytes fixed across baseline and candidate runs. Report missed corrections, incorrect substitutions and unchanged-control preservation separately, including failures on difficult examples. Once holdout results have informed implementation, that split is regression data rather than an unseen benchmark.

`SHA256SUMS` records the frozen fixture hashes:

```text
3d6690b46211d8a46d2d03628eab0c0dfd9d124b3ecba5159de0261cc81237d7  dev.json
09b8ebee40c76a0d7e88b05ffa77037fe4bc3682b9032cb41112d300b2db9179  holdout.json
```

Evaluation reports belong outside these frozen fixtures. The integrating owner is responsible for recording candidate revisions and the point at which holdout evaluation occurred.
