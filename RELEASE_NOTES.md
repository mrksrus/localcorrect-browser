# 1.0.0-rc.5

More coverage on the known main corpus, with stronger ambiguity protection. Fixed browser RC4 and native Outlook RC3 releases remain unchanged.

The known main 5,000 cases gain 383 wanted edits and 210 completely corrected documents, with zero unwanted edits. Main error coverage is 70.16%. The final separately authored 100-document audit has 35 wanted edits, zero unwanted edits, 30 missed edits and 76/100 exact outputs. Fixed RC4 made 38 wanted edits with zero unwanted edits on that final 100-case audit, so the fresh set does not show a coverage gain. This is observed synthetic precision, not universal perfection or 100% error coverage.

An initial RC5 audit exposed two unwanted edits and was consumed by fixes. Its failed evidence remains published. A second 200-document audit exposed one more unwanted edit and was consumed too. The final 100-case audit from a different author was first evaluated after the last policy freeze. Some old correct edits are now intentionally left unchanged when the wider vocabulary reveals ambiguity.

The engine adds compact candidate and lexical ambiguity indexes plus attributed CSpell and Homebrew protective vocabulary. Per-call caching avoids repeated searches for repeated typos. No neural training, test-gold lookup or document-derived persistent cache is used. Runtime remains fully offline and manual-shortcut driven.

See QUALITY.md, EVALUATION.json and benchmarks/rc5-cpu-performance.md for exact results, startup cost, resource measurements, source hashes and device limitations. Firefox remains unsigned; actual Outlook 2019 acceptance remains unverified.
