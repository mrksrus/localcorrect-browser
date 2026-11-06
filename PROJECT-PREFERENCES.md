# Project preferences

## Accepted decisions

- LC-01, 2026-11-04. English and German typo correction must run entirely locally. No cloud correction, telemetry, document logging or remote execution of user text. Build-time dependencies and bundled dictionaries may have explicit provenance.
- LC-02, 2026-11-04. Manual correction in one pass through a user-editable keyboard shortcut, with an explicit button as an alternative. Preserve intent and unrelated formatting. Do not promise perfect grammar or universal field support. Prefer abstention to an unsafe speculative replacement.
- LC-03, 2026-11-04. Evaluate improvements on separate synthetic development and holdout cases. Report exact correction coverage, incorrect substitutions, unchanged-text preservation, latency and material limits. Personal chat-derived examples stay private and never enter public fixtures or logs.
- LC-04, 2026-11-04. Firefox is the primary requested browser, with Chrome compatibility retained. No permanent all-sites permission or keystroke monitoring. Same-origin focused frames can be supported through the explicit action; protected browser pages and inaccessible frames remain outside reach.

- LC-05, 2026-11-05. Avoiding unintended edits takes priority over correction coverage. The user prefers a missed typo to an incorrect replacement; leave uncertain text unchanged. Report wrong edits separately from missed corrections.

- LC-06, 2026-11-05. Target at least 99% precision among edits actually made, with unwanted edits as close to zero as possible. Report missed corrections separately, never as successful edits. Aim for roughly one second for a 1,000-word email on CPUs from 2020 onward; publish measured cold and warm latency and hardware rather than claiming a universal guarantee. Publicly publish synthetic evaluation data and credit SymSpell and all reused data sources accurately.

- LC-07, 2026-11-05. Keep browser RC4 and native Outlook RC3 fixed as comparison releases. Subsequent candidates should maximize exact whole-document corrections and minimize missed edits while retaining zero observed unwanted edits as the primary acceptance goal. Old published tests become regression data when consulted; use fresh independent validation before new generalization claims.
- LC-08, 2026-11-05. Up to about 1 GB RAM is an upper resource allowance, not a target. Prefer correction-policy, representation and algorithm improvements first; retain comfortable use on roughly five-year-old CPUs and the existing approximately one-second long-email target. Small resource changes are acceptable, but substantial hardware escalation requires first exhausting model improvements and the authorized research escalation.

- LC-09, 2026-11-06. The user now allows conventional training and fine-tuning to improve sentence context and structure. This supersedes the earlier no-training experiment constraint. Offline inference, preference for abstention over unwanted edits, immutable fixed releases and the approximate 1 GB runtime ceiling still apply. Trained experiments must earn adoption through separate validation and measured CPU/RAM.

## Observed implementation

The shared engine began with SymSpell symmetric-delete lookup. The current compiler generates static typo priors from attributed public data and unique common typing repairs; runtime uses compact lookup tables, bilingual validity checks and literal/name protections. It is not a trained neural model. No test gold enters candidate compilation. Both saved modes currently share the same precision-first policy.

## Open decisions

Actual Office2019/Windows acceptance and Firefox signing require their own evidence; successful cross-compilation or headless browser tests must not be presented as live acceptance.
