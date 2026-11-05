# RC5 quality and limits

Browser RC4 and native Outlook RC3 remain fixed comparison releases. RC5 improves coverage on the known main corpus while prioritizing abstention over an unwanted replacement. Fresh-audit coverage and regressions are reported separately below. It is still a static spelling engine, not a neural language model or a universal grammar corrector.

## Final frozen results

| Set | Wanted | Unwanted | Missed | Exact whole documents | Clean controls |
|---|---:|---:|---:|---:|---:|
| Known development | 2,469 | 0 | 1,121 | 2183/3000 | 1200/1200 |
| Known former holdout | 1,725 | 0 | 663 | 1455/2000 | 800/800 |
| Known former blind audit | 57 | 0 | 33 | 78/100 | 70/70 |
| Consumed first RC5 audit | 92 | 0 | 130 | 120/200 | 100/100 |
| Consumed second RC5 audit | 75 | 0 | 142 | 123/200 | 100/100 |
| Final independent audit, fresh at first evaluation | 35 | 0 | 30 | 76/100 | 50/50 |

Both saved modes have the same policy and results. Every edit actually made in these sets matches its intended gold edit. This is **100% observed edit precision**, not correction of 100% of errors. Misses remain misses. A wrong replacement counts as both an unwanted edit and a missed gold edit. Exactness compares the entire output document with gold, using original-input UTF-16 spans.

On the known main 5,000 documents, RC4 made 3,811 wanted edits, zero unwanted edits and missed 2,167; it completed 3,428/5,000 documents. RC5 makes 4,194 wanted edits, zero unwanted edits and misses 1,784, completing 3,638/5,000. That is 383 more wanted edits and 210 more complete documents. Error coverage is 70.16%, versus 63.75%.

The 5,000 total include 2,000 clean controls. Among only the 3,000 typo-bearing documents, exactness is 1638/3,000, or 54.60%, versus 1428/3,000 for RC4. These denominators must not be confused.

Stronger ambiguity protection also loses some formerly correct edits. On the old 100-case audit RC4 made 66 wanted edits and completed 81 documents; RC5 makes 57 wanted edits and completes 78. This tradeoff follows the explicit preference for no change over a wrong change. All misses and full per-case outputs are available, including regressions.

On the final untouched 100 cases, the candidate made 35 wanted edits, zero unwanted edits and missed 30, completing 76/100. Fixed RC4 made 38 wanted edits, zero unwanted edits and missed 27, completing 78/100. This fresh set does not demonstrate a coverage gain. The larger gains on consulted data are regression/development evidence, not an estimate of general improvement.

## What was fresh

The original 5,000 templated documents and earlier 100-document audit were consulted while developing RC5. They are known regression tests. The 5,000 share sentence templates and a restricted vocabulary; their target families are separated between the original splits, but the cases are not 5,000 independent real-world messages. Existing codespell/Litkey pairs and other public spelling knowledge can overlap gold. See the [authoring notes](tests/scale-corpus/AUTHORING-NOTES.md) and [source notices](tests/scale-corpus/SOURCES.md).

A separately authored first 200-document RC5 audit exposed two wrong edits in the first frozen candidate, including an English replacement inside a foreign phrase and an ambiguous plural whose intended word needed two repairs. That candidate was rejected. Its frozen source and 94-wanted/2-unwanted/128-missed results remain in [history](benchmarks/history/rc5-rejected-first-audit.json). This first audit became regression data; its gold was not changed.

The second independently authored 200-document audit found one remaining unwanted edit, a Welsh word changed into the proper name Cannes. That candidate was rejected too, and the second audit became regression data. Its 75-wanted/1-unwanted/142-missed results and source freeze remain in history. A general English proper-name-only target veto fixed the class without adding a phrase blacklist. Exact functional cores for both rejected snapshots accompany the release as a separate source archive.

A different author then created 100 new documents without access to the engine, compiler, prior gold, failures or results. Its completed hash was supplied before implementing-agent inspection and engine evaluation. The final functional policy and all six gold hashes were frozen first in [evaluation-freeze.json](evaluation-freeze.json). Only this final 100-case audit was fresh at its first final-policy evaluation. After publication it becomes regression data for future work. These synthetic contexts do not establish a population error rate or eliminate missing vocabulary and ambiguous intent.

## Improvement loop and rejected trials

The accepted changes add verified inflected forms from frequency-selected source dictionary bases and a bounded one-edit candidate index, complete competing-word checks over the supplied English/German and protective inventories, sourced technical/name vocabulary, conservative productive-form preservation, and per-call reuse of completed ambiguity checks. A small minimized lexical automaton replaces costly repeated edit probes. Its decoded data occupy 1,974,212 bytes. The combined static language assets occupy 44,584,587 bytes on disk; this is not a neural weight count.

Faster-looking coverage trials were rejected when they caused wrong edits. Removing frequency preservation caused 206 wrong edits on the known main corpus. Keyboard filtering of competing interpretations excluded valid alternatives and failed independent source-derived challenges. Broadly trusting attested codespell/Litkey labels caused six wrong choices in 151 ambiguity challenges. A conservative two-sided English bigram trial and a source-defined German REP trial produced no additional main-corpus corrections and are excluded from runtime. The latter generated 1,631 unique source-defined proposals only after a complete two-edit ambiguity veto.

Sol independent reviews checked source, representation and preservation. Astra was used after several local approaches stalled, for bounded research on ambiguity, morphology and context. No substantial hardware increase was adopted. The inflection compiler keeps the original Hunspell flags/affix rules, validates expanded forms against the full language inventory, and excludes every existing frequency target. Comparing a base-frequency floor of 1,000 with the initial source floor of 150 gained four more wanted edits and two whole documents without observed unwanted edits on the known 5,300 cases, for about 660 KB additional static data. The final floor 150 uses the existing base vocabulary; it does not fabricate frequency counts or copy gold answers.

No test gold, user messages or private correspondence is read by the inference compilers. The [326 independently authored preservation inputs](tests/preservation-regression.json) and [151 known source-derived ambiguity challenges](tests/ambiguity-regression.json) are public regression data.

The final policy rejects unverified English proper-name-only targets outside the existing calendar exception, preserves unsupported-script/diacritic neighbors as possible foreign wording and uses a complete two-edit veto for recognized regular English plural candidates. These are general abstention rules, not phrase blacklists. Other repairs retain the bounded one-edit ambiguity check. Productive German compounds and vocabulary remain incomplete. Eight historical English function-word exceptions remain heuristic. Shared search budgets can deliberately leave text unchanged.

## CPU, memory and startup

[Exact CPU/RAM measurements](benchmarks/rc5-cpu-performance.md) and [machine-readable provenance](benchmarks/rc5-cpu-performance.json) use this laptop's 2020-era Intel i5-1038NG7, 4 cores/8 threads. The native probe uses the production wrapper with Jint 4.17/.NET 10 on Linux, not Windows Office. The final measurement uses two 1,000-word typo-heavy scenarios, one per language, with one first action and three warm repeats per scenario. Earlier broader and base-warm runs are historical evidence, excluded from the final timing table. Three samples are not a population percentile.

The native engine stays within the approximate one-second warm long-email goal in these tests and remains below the 1 GB upper allowance. Native initialization is separate and takes 11.6–12.0 seconds in a background warmup; an immediate action can wait. On the two final 1,000-word stress fixtures, native first actions took 1.01–1.21 seconds and warm medians were 378–391 ms. Whole-process native RSS peaked at about 455 MiB; this is an isolated engine process, not measured extra Outlook RAM. Node results are a browser-engine proxy, not measured extra Firefox RAM. Editor/COM/DOM application and actual device integration are separate from core inference. Read the linked report for exact cold/warm latency, CPU time, whole-process RSS, hashes and remaining startup cost.

## Runtime acceptance

The final validation record and downloadable comparison report include both models' outputs on all 5,600 cases, with misses, wrong spans and controls. Core tests verify exact spans, abstention, asset integrity and independent finite-state search oracles. Browser tests cover ordinary rich text, textarea, Undo, extension resources and shipping Firefox shortcuts with external network blocked. Corpus format validation permits ordinary three-block greeting/body/signoff emails; it does not change gold or correction scoring.

Windows CI separately checks shared-engine parity and installer filesystem behavior. It does not establish actual Outlook 2019 x86/x64 add-in loading, formatting, shortcuts, Undo or uninstall. Those remain unverified. Firefox ZIPs are unsigned temporary-development packages; Mozilla signing and complex production editors remain separate acceptance work.
