# RC5 independent audit

200 independently authored synthetic documents, 100 English and 100 German, with 100 typo-bearing cases and 100 unchanged controls. There are 80 emails, 80 other multi-paragraph texts and 40 short texts. Ten long emails contain 855–913 words. Gold edits use original-input UTF-16 offsets. No real correspondence or private chat text is included.

The author had no access to the engine, compiler, existing gold or evaluation results. The completed data hash was supplied before engine evaluation. The implementing agent froze the complete functional policy in the archived `benchmarks/history/rc5-rejected-first-freeze.json` before copying or inspecting the cases and before the first engine evaluation. This tests fresh authored contexts and safety challenges, not necessarily unseen spelling pairs or an independent sample of everyday usage.

After publication these cases are known regression data. Retuning on them must not be described as unseen validation. The cases and intended edits are published under GPL-3.0-only with the repository.

The first frozen candidate made 94 wanted edits, two unwanted edits and missed 128, with 119/200 exact documents. It was rejected. Subsequent fixes used this audit as regression data. Its initial frozen source and complete results remain in `benchmarks/history/rc5-rejected-first-*`. A separate second audit was authored for fresh validation after those fixes. The gold here was not edited.
