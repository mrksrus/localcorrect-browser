# 1.0.0-rc.4

Precision-first English/German correction. The new frozen evaluation makes zero
unwanted edits on 5,000 synthetic documents plus a separate 100-document blind
set. Main error coverage is 63.75%; blind coverage is 73.33%. Misses are intentional
when the engine lacks enough evidence. These measurements do not guarantee
real-world perfection.

Public downloads include all cases/gold, both models' outputs, an offline
comparison, source/licensing notes and reproducible CPU measurements. The starting
point, Wolf Garbe's SymSpell, is credited explicitly. This is an original
implementation with a compiled static lookup, not neural fine-tuning.

CPU profiling led to bounded context checks and offline candidate generation.
The native engine measured 124–153 ms warm medians for 1,000 words on this 2020-era
Intel i5, after about 5.5 seconds of initialization. Native Outlook prewarms its
static data in a background worker; real Office device acceptance remains pending.

Quotations, recognized words in either language and uncertain candidates are
preserved. Partial-word native selections are now refused. Both saved modes share
the same current safety policy. No permanent host permission or typing monitor
was added. The Firefox ZIP remains unsigned and temporarily installed.

See QUALITY.md for exact counts, dependence/overlap limits and device boundaries.
