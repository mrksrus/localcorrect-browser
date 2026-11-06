# English context development calibration

This is known synthetic development calibration data for RC6's learned English
single-word actions. It may be used to inspect proposals, choose thresholds and
check preservation during development. It is not neural training data, a held-out
test, an independent fresh audit or evidence of a natural population error rate.
Its cases are exposed to the implementation owner from creation onward.

`cases.json` contains 400 English documents, with 200 intended errors and 200
safe controls. Each of ten fixed families has exactly 20 error documents and 20
safe documents:

| Family | Error | Safe |
|---|---:|---:|
| a / an | 20 | 20 |
| is / are | 20 | 20 |
| was / were | 20 | 20 |
| has / have | 20 | 20 |
| do / does | 20 | 20 |
| from / form | 20 | 20 |
| their / there | 20 | 20 |
| then / than | 20 | 20 |
| where / were | 20 | 20 |
| to / too | 20 | 20 |

There are 360 short documents, 20 email drafts and 20 documents with multiple
paragraphs. The 40 longer documents are included in the 400 total. Email names
and situations are invented; no private messages, addresses or chat excerpts are
used. One erroneous email has an emoji before the edit to exercise UTF-16 offsets.

## Authorship and coverage

An AI assistant wrote the sentences for this task without inspecting model
outputs, existing calibration cases, training document text, held-out tests or
the sealed fresh audit. The optional generator renders those written entries; it
does not read a model, source corpus or other fixture. Each erroneous entry has
one explicit `[[original|replacement]]` marker in the generator source. There is
no randomized noun substitution or automatically inferred grammar gold.

The examples distinguish article sound from spelling, including a university,
a uniform, a useful example, a European map, an hour, an heir and an honest
question. Agreement cases cover singular/plural subjects and pronouns, while
controls include a pair of scissors, plural scissors, news, emphatic do/does and
subjunctive were. Other contrasts cover form as a noun or verb, from as a
preposition, possessive their, existential/locative there, temporal then,
comparative than, locative where, past were, infinitival/directional to and
intensifying/additive too.

Safe controls include grammatical ordinary prose, names, identifiers, code and
exact quotations. Some quotations intentionally contain nonstandard wording that
must remain literal. A safe label means the entire supplied document should be
preserved, including those quotations; it does not ask the corrector to repair a
quoted speaker or rename an identifier.

These are deliberately clear examples with a balanced error/safe ratio and
repeated everyday themes. They do not sample dialects, specialized writing,
ambiguous intent, all possible constructions or the prevalence of errors in real
email. Handwritten entries can contain annotation mistakes and need review. A
good result here can reflect threshold tuning to this known set. It cannot
replace the separate frozen-policy test and sealed fresh audit.

## Gold contract and reproduction

Every case has `id`, `document_id`, `language`, `source`, `split`, `family`, `kind`,
`format`, `input`, `expected` and explicit `edits`. The split is always
`development-calibration`; it is never `train`. Each erroneous document has
exactly one whole-word replacement within its declared two-word family. Every
safe document has no edits and has identical input/expected strings. Offsets and
lengths count UTF-16 code units in the original input.

Run from the repository root:

```sh
python3 tests/context-calibration/generate.py
```

The generator checks the 20/20 family quotas, unique IDs and input strings,
single-word boundaries, family membership and exact gold reconstruction through
UTF-16 byte spans. It rewrites only `cases.json` in this directory and prints the
counts and SHA-256. Rendering is deterministic.

Initial validated `cases.json` SHA-256:
`125842f6756d675bb0390c640072741a6d8c12e89298b4690aa327d366f0c4cc`.

No model-quality result is recorded here. Report wanted edits, unwanted edits,
misses, safe-document preservation and exact-document corrections separately when
this known calibration set is evaluated. Do not present it as newly unseen data
after using it to change the policy.
