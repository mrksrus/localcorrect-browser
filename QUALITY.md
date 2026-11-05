# Quality and performance, RC4

This is a symbolic local spelling corrector, not a neural model. The priority is
precision among edits actually made. Missed typos remain missed, not successful
corrections. The two saved modes currently use the same candidate policy.

## Frozen evaluation

The policy was frozen before the first evaluation of the new 2,000-document
holdout or 100-document blind set. Exact functional source and corpus hashes are
in [evaluation-freeze.json](evaluation-freeze.json). There was no policy tuning
after seeing those results. Both original gold sets remain unchanged.

| Set | Documents | Wanted edits | Unwanted edits | Missed edits | Edit precision | Error coverage | Clean documents preserved |
|---|---:|---:|---:|---:|---:|---:|---:|
| Development | 3,000 | 2,284 | 0 | 1,306 | 100% | 63.62% | 1,200/1,200 |
| Held-out target families | 2,000 | 1,527 | 0 | 861 | 100% | 63.94% | 800/800 |
| Independent blind context | 100 | 66 | 0 | 24 | 100% | 73.33% | 70/70 |

Across the main 5,000 documents, this is **3,811 wanted, zero unwanted and 2,167
missed edits**. Exact documents are 3,428/5,000, including unchanged controls.
The blind set has 81/100 exact documents, including all 70 clean controls.
Do not interpret 100% measured edit precision as 100% error coverage, or as proof
of 99% precision on arbitrary real writing.

The previous RC3 Conservative engine on these same sets produced:

| Set | Wanted | Unwanted | Missed | Edit precision | Clean documents preserved |
|---|---:|---:|---:|---:|---:|
| Development | 3,229 | 518 | 361 | 86.18% | 989/1,200 |
| Holdout | 2,090 | 351 | 298 | 85.62% | 647/800 |
| Blind | 81 | 20 | 9 | 80.20% | 56/70 |

This is a deliberate reduction in coverage to avoid unsupported changes. Both
models' complete per-case outputs, wanted/wrong/missed spans and both modes are
included in the downloadable report, not just successful examples.
[EVALUATION.json](EVALUATION.json) contains machine-readable summaries and hashes.

## What the tests establish

The 5,000 new documents comprise 2,500 EN/2,500 DE, 3,000 correction cases and
2,000 controls; 2,000 complete emails, 2,000 other multi-paragraph texts and 1,000
short texts. There are 5,978 gold edits, 1,592 distinct used error pairs and 339
target families. A subset of 100 emails contains 974–1,017 words.

The corpus was authored without engine or earlier-fixture access. It uses
invented adult contexts, 119 curated codespell and 94 curated Litkey pairs plus
controlled keyboard mutations. It repeats authored sentence/paragraph templates.
Targets are separated between dev and holdout; shared templates and limited
vocabulary mean these are not 5,000 independent real-world messages. See
[authoring notes](tests/scale-corpus/AUTHORING-NOTES.md) and
[source licenses](tests/scale-corpus/SOURCES.md). Original chat text, private
correspondence and raw pupil stories are not published.

Some gold pairs were already in the public-data/typing prior before evaluation:
2,322/3,590 dev edits, 1,572/2,388 holdout edits and 67/90 blind edits. This is prior
membership before case/context gates, not an independent unseen-pair score. No
test file is read by the prior compiler. The separate blind set tests fresh
contexts and preservation traps, not unknown linguistic knowledge. Zero observed
unwanted edits on these dependent, synthetic samples cannot certify a population
error rate.

A wrong replacement counts as both an unwanted edit and a missed gold edit.
Offsets are exact UTF-16 spans into original input; output is reconstructed and
checked. No-op controls have empty gold edits. Alternate plausible replacements
still count as unwanted when they differ from the authored intended correction.
The older 92/200/40 fixtures remain public regression data. They were previously
consulted and are not relabeled as fresh holdouts in this release.

## Improvement loop

1. The known 40-case audit exposed literal quotations, rare/ambiguous candidates
   and unwanted German noun capitalization.
2. Quote preservation and bilingual validity removed unsafe edits. Weak and
   ambiguous guesses were reduced, with missed edits measured separately.
3. Profiling found repeated full-prefix German context scans and expensive
   interpreter candidate searching. Context was bounded, capitalization guessing
   removed, and candidate compilation moved offline.
4. The compiler builds unique common typing repairs and filtered public typo
   priors using SymSpell deletion keys and actual edit distance. Independently
   reviewed ambiguity examples led to filtering public priors too. A documented
   eight-function-word transposition exception remains heuristic.
5. Missing-letter repairs recovered useful coverage without increasing measured
   development unwanted edits. The final policy was then frozen and validated.

The loop changed rules and attributed static data. It did not train neural
weights or add gold fixture pairs to the runtime. Sol independent reviews and
blind authorship were used. No Astra agent was needed in this iteration.

## CPU measurements

Dedicated frozen-candidate measurements used this laptop's Intel Core i5-1038NG7,
a 2020-era 4-core/8-thread CPU. Synthetic 150/1,000-word EN/DE emails include clean
and typo-heavy bodies without signature/quotation shortcuts. Each fresh-process
case has one first correction and exactly three warm repeats.

| Linux .NET 10/Jint measurement | Result |
|---|---:|
| Static engine initialization | 5.21–5.58 seconds |
| First 1,000-word correction after initialization | 222–487 ms |
| Warm 1,000-word median | 124–153 ms |
| Maximum measured warm 1,000-word correction | 163 ms |
| Peak process RSS | 367–369 MiB |
| Full cold initialization plus first correction | 5.43–5.82 seconds |

A separate base-warm/new-document run measured 145–436 ms for its first 1,000-word
document. Node warm core inference was about 2–5 ms for 1,000 words. These timings
exclude editor/COM/DOM application, first extension resource loading and network
installation. The native add-in preloads static dictionaries off the UI thread;
this reads no email. An action before warmup finishes waits for initialization.

[Full performance report](benchmarks/cpu-performance.md),
[raw measurements and hashes](benchmarks/cpu-performance.json), and
[reusable synthetic fixtures](tests/performance-fixtures.json) are published.
These results support the approximate one-second warm engine goal on this CPU,
not a guarantee for every CPU released after 2020, power mode or editor.
Linux .NET 10 results are not actual Windows Outlook measurements.

## Runtime and device checks

The final check record accompanies the release downloads. Browser tests cover
core safety, original spans, ordinary rich-text/textarea behavior, Undo, extension
resources and shipping Firefox commands with blocked external network access.
Runtime parity compares full outputs to the Node reference; it does not substitute
for gold quality scoring. Whole-email Firefox tests can contain intentional
abstentions and do not claim every gold typo was fixed.

Windows CI separately runs the shared engine under .NET 10 and net48 AppDomain,
plus installer filesystem tests. Actual Outlook 2019 x86/x64 add-in loading,
formatting, keyboard behavior, Undo and uninstall remain unverified. Firefox
archives are unsigned temporary-development packages. Mozilla signing and
arbitrary production editors are separate acceptance work.
