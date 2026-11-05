# LocalCorrect final policy performance

Measured on one Linux x86_64 laptop with an Intel Core i5-1038NG7, four cores and eight threads. Node v26.7.0 and the native Jint 4.17.0 engine under .NET 10.0.14 were measured serially.

After native constructor initialization, the first real 150-word input takes 167 to 261 ms and the first 1000-word input 222 to 487 ms. Three following 1000-word repeats have medians 124 to 153 ms and a maximum 163 ms. All cases succeed within existing limits. All clean inputs produce zero edits.

Native constructor initialization takes 5.21 to 5.58 s and includes all three broad lexical inventories. Constructor plus the first correction takes 5.43 to 5.82 s, excluding process startup. Peak native process resident memory is 367 to 369 MiB. These cold and warm timings must remain separate.

## Exact source and artifact identity

| Component | SHA256 |
|---|---|
|Core source index.js|`20907ded1f2194ad820043b29176e95de7932f36cc4347e8569408b08ebcf0e7`|
|Typo inventory typos.js|`1d21b2718c3f4a448083825850a540fec22d5e60c77f5951f52b1608ea7677d8`|
|Generated native JS bundle|`139c45c51c20fa937f698a7439c5d289ab640dfe09649472cb16a8a6f6dc0421`|
|Compiled native Engine DLL|`5eb9d1fa043554056a0bcb7190b0ec4900eeb3546250907cb8c699dd25aa1796`|

The native DLL's reflected embedded JS bundle hash matches the generated bundle. Complete core, dictionary and lexical-asset hashes are in cpu-performance.json. Repository commit fields identify the base commits; the source and artifact hashes identify the tested working candidate.

## Eight representative inputs

Each input uses a fresh process, one first correction and three following corrections of the same input. Constructor timing is separate. Static typo shards are untouched before the first correction. Node module import is also separate and is recorded in the JSON.

| Input | Node first ms | Node warm median / max ms | Native constructor ms | Native first ms | Native warm median / max ms | Native peak RSS MiB |
|---|---:|---:|---:|---:|---:|---:|
|en-ordinary-clean|77.4|0.3 / 0.6|5583.3|167.4|74.7 / 95.5|367.2|
|en-ordinary-typo-heavy|83.0|0.6 / 1.0|5280.6|233.5|80.8 / 93.6|367.1|
|en-1000-clean|76.1|1.6 / 1.8|5206.7|221.9|123.9 / 125.6|367.4|
|en-1000-typo-heavy|91.3|3.6 / 3.8|5243.0|455.5|147.9 / 147.9|368.3|
|de-ordinary-clean|79.4|0.5 / 0.6|5417.5|225.8|75.8 / 90.6|367.1|
|de-ordinary-typo-heavy|83.3|0.8 / 0.8|5275.8|260.7|79.0 / 92.6|367.9|
|de-1000-clean|90.6|2.5 / 2.8|5437.8|385.5|131.1 / 132.5|367.2|
|de-1000-typo-heavy|102.3|4.4 / 5.0|5307.2|487.3|153.3 / 162.7|368.7|

The prose is synthetic office-move email text, trimmed to exactly 150 or 1000 alphabetic core word tokens. These are excerpts and can end mid-sentence. EN 1000-word is 5877 characters and DE 1000-word is 6950. Heavy variants inject 15/105 EN or 13/84 DE lowercase adjacent swaps for 150/1000 words. This is a latency corpus; the perturbations have not been separately adjudicated as accuracy labels. The exact synthetic fixtures and their hashes are supplied in cpu-performance-fixtures.json.

Every fixture has zero protected ranges, asserted using the tested core. No signature or quoted tail skips most of the body. Both language and mode are explicit; all measurements use conservative mode.

## Base prepared, first new document

Each row below is another fresh native process. After the constructor, Correct('', 'en', 'conservative') is called once. It touches no document words or typo-prior shards. Then the real 1000-word input is corrected once and repeated three times. All three broad lexical inventories are already prepared by the constructor, including German original casing.

| Input | Constructor ms | Empty call ms | First real document ms | Following median / max ms | Peak RSS MiB |
|---|---:|---:|---:|---:|---:|
|de-1000-clean|5390.1|154.7|307.4|111.6 / 124.9|368.3|
|de-1000-typo-heavy|5382.3|157.7|436.5|156.6 / 177.3|368.4|
|en-1000-clean|5308.1|230.3|144.6|104.0 / 111.1|367.4|
|en-1000-typo-heavy|5267.9|157.1|360.5|136.2 / 148.0|367.3|

First new-document processing after the empty call takes 145 to 436 ms, with no artificial document used to warm the typo shards. Following repeat maxima are 111 to 177 ms. The empty call itself costs 155 to 230 ms and is reported separately.

## Scope of the result

These results support the approximately 1 second correction target on this laptop once the native constructor finishes. They do not establish a bound for every CPU made since 2020. Node V8 is a core-engine proxy, not a Firefox/Chrome UI measurement. Native measurements use Linux .NET 10; Windows .NET Framework 4.8 and actual Outlook 2019 require their own validation. The three repeat samples per input support medians and maxima, not a population p95. Correction precision and recall are evaluated separately.

No repository source, shared build outputs, system settings or installed packages were changed for the benchmark. Private instrumentation and isolated builds were used. No real user email text was used.
