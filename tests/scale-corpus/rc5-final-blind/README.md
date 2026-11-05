# Final RC5 independent audit

100 independently authored synthetic documents: 50 English and 50 German, 50 typo-bearing and 50 unchanged controls, with 65 gold edits. Each language has 25 correction and 25 safe cases. Formats are 40 complete emails, 40 other multi-paragraph documents and 20 short messages, including four long emails with two per language. Original-input edit positions use UTF-16. Python and JavaScript validators independently checked reconstruction, spans, counts, uniqueness, word/unit bounds and formats. No private chat text or real correspondence is included.

A different author had no access to the engine, compiler, earlier gold, failed audits, correction policy or evaluation results. The completed hash was supplied before implementing-agent inspection or engine evaluation. The complete final policy and all six gold hashes were frozen in `evaluation-freeze.json` before copying or inspecting these cases.

Only this final 100-case set was fresh at its first final-policy evaluation. It tests authored contexts, not necessarily unseen spelling pairs or an independent random sample of everyday usage. After publication it becomes known regression data and cannot be reused as unseen validation after tuning. Synthetic cases and intended edits are published under GPL-3.0-only with the repository.
