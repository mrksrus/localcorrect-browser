# Project preferences

## Accepted decisions

- LC-01, 2026-11-04. English and German typo correction must run entirely locally. No cloud correction, telemetry, document logging or remote execution of user text. Build-time dependencies and bundled dictionaries may have explicit provenance.
- LC-02, 2026-11-04. Manual correction in one pass through a user-editable keyboard shortcut, with an explicit button as an alternative. Preserve intent and unrelated formatting. Do not promise perfect grammar or universal field support. Prefer abstention to an unsafe speculative replacement.
- LC-03, 2026-11-04. Evaluate improvements on separate synthetic development and holdout cases. Report exact correction coverage, incorrect substitutions, unchanged-text preservation, latency and material limits. Personal chat-derived examples stay private and never enter public fixtures or logs.
- LC-04, 2026-11-04. Firefox is the primary requested browser, with Chrome compatibility retained. No permanent all-sites permission or keystroke monitoring. Same-origin focused frames can be supported through the explicit action; protected browser pages and inaccessible frames remain outside reach.

## Observed implementation

The existing shared engine is a SymSpell-based spelling corrector with bundled frequency and validity data, not a trained neural model. A neural component should be added only with demonstrated value, not presented as necessary for this product.

## Open decisions

Actual Office2019/Windows acceptance and Firefox signing require their own evidence; successful cross-compilation or headless browser tests must not be presented as live acceptance.
