# RC5 CPU probe

Measured on Intel(R) Core(TM) i5-1038NG7 CPU @ 2.00GHz, Linux 7.2.11-arch1-Watanare-T2-1-t2. Node v26.7.0; native Jint 4.17 under .NET 10.0.14. Native results use the production Corrector.cs wrapper in an isolated Linux .NET 10 project, so they are not Windows/.NET Framework 4.8/Office acceptance.

2 public synthetic 1000-word typo-heavy stress scenarios of the final candidate, a fresh process per fixture, one first correction and three warm corrections. Earlier four/eight-fixture candidates remain historical in archive/. Three warm samples support a small probe, not a percentile guarantee. Setup includes Node module import plus corrector creation; native setup is wrapper construction including bundle execution. Whole-process RSS includes dictionaries and runtime. CPU measurements sum process CPU time across runtime threads, so CPU time may exceed wall time. Elapsed times are wall time. No document-derived persistent cache is used by this snapshot. Repeated fixture results measure warmed static/JIT state. No blinded quality fixtures were accessed.

Snapshot tree SHA256 `788152eee44b79022d5f4ca1a053e9cd915249b7682bcdad5cd7711ebbecbe81`; generated embedded bundle `67f43f32203d39438135fa6331594ece54f2b2606b2b7e989225f2ec7b635290`. Every native process reports its embedded bundle hash and matches this new bundle. No previously built engine DLL was reused.

Fresh process and first document, followed by repeats of that same document.

|Runtime|Fixture|Setup ms|Base warm ms|First ms|Warm p50 ms|Warm max ms|Warm CPU p50 ms|Whole peak MiB|Edits|
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
|node|en-1000-typo-heavy|382|n/a|157|8|10|14|227|53|
|node|de-1000-typo-heavy|381|n/a|174|10|11|20|227|47|
|jint|en-1000-typo-heavy|11582|n/a|1008|391|462|757|455|53|
|jint|de-1000-typo-heavy|11964|n/a|1209|378|399|621|454|47|

These measurements do not support a strict one-second guarantee. Native startup remains approximately 12 seconds.

Measured native 1000-word typo-heavy actions: en-1000-typo-heavy first 1008 ms, warm median 391 ms and max 462 ms; de-1000-typo-heavy first 1209 ms, warm median 378 ms and max 399 ms.

Runtime source or dictionary files that now differ from snapshot: []. Non-runtime metadata changes: []. Functional performance applies while runtime inputs remain identical; metadata-only changes do not invalidate these timings. `runtime-hashes.json` records every source/vendor/dictionary file separately.

Rerun after final freeze: `python3 prepare.py --refresh`, rebuild `native/Bench.csproj` with `--disable-build-servers -p:UseSharedCompilation=false -nodeReuse:false`, `python3 run.py --stress-only` for these two stress scenarios, then `python3 report.py`. The isolated project embeds newly bundled snapshot JS and both snapshot dictionaries. No package installation, repository mutation, browser full build, Git write or Git push is performed.
