# Independent spelling audit

Frozen on 2026-11-05 before any correction-engine evaluation.

The author wrote these synthetic documents independently after reading only the shared working agreements, project preferences, and applicable workflow skills. The author did not inspect the correction engine, existing corpora, evaluation reports, or failure words, and did not invoke the engine. The source context was branch `fix/offline-hotkey-correction` at the parent-provided starting revision `c42041d`; no runtime behavior was inferred from that revision.

The corpus contains 40 unique documents: 20 English and 20 German. Each language has 15 correction cases and 5 unchanged controls. There are 20 complete emails, 12 other multi-paragraph texts, and 8 short texts. Every email has a greeting, three body paragraphs, and a closing. Each correction case has three spelling edits, for 90 gold edits total. Each language includes a CRLF email with an emoji before its edits.

All situations, names, correspondence, and contact details are synthetic. Contact addresses use reserved example or invalid domains. Natural business, personal, community, and technical situations were chosen without consulting engine output. Controls intentionally include regional spellings, mixed-language words, names, exact quotations, code, identifiers, and real-word ambiguity. Gold edits are outside quotations, code, identifiers, and signatures. There are no grammar rewrites.

The author manually reviewed each intended correction and its surrounding sentence before freezing. Mechanical checks verified document and format counts, unique input texts, correction/control balance, three edits per correction case, sorted non-overlapping bounded UTF-16 offsets, original-span matches, exact reconstruction of expected text, unchanged control bytes, complete email structure, and CRLF/emoji coverage. No spellchecker or correction model selected, accepted, or rejected examples.

The JSON file is UTF-8 with a trailing newline. Its immutable SHA-256 is `3a4b8976beea41f380cad074d1b215b485ff41fc28e04df3b1f1645786f4dc2f`. `audit.sha256` records the same digest. Preserve these bytes when evaluating a candidate. Report audit findings separately from development and previously inspected holdout results. Once its results are inspected, this corpus is no longer an unseen audit for subsequent tuning. This synthetic sample does not establish performance on private correspondence, arbitrary domains, or every regional spelling.
