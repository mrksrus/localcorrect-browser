# 1.0.0-rc.7

English/German text selection now has an explicit mixed-language vocabulary setting. Leave it enabled for text containing both languages, or disable it to use only the selected language's spelling vocabulary. Interface language stays independent. The saved choice reaches browser shortcuts and the companion native Outlook RC6 helper; older settings preserve mixed behavior.

The neural model and calibrated thresholds are unchanged. Selected-language spelling adds 117 wanted edits across the 6,200 known synthetic cases, with zero observed unwanted edits and all 2,620 clean controls preserved. The former RC6 independent200case audit still has no coverage gain. These consumed tests are not a claim of broad real-world grammar accuracy. See QUALITY.md.

The additional spelling prior has only 995 rows over the unchanged base table, avoiding duplication. Warm 1,000-word Node CPU/WASM fixtures remain below one second on the development i5-1038NG7, with peak process RSS around 574–602 MiB. Native helper/Outlook overhead is separate.

Actual Chrome and Firefox checks exercise saved false/default settings, independent UI/text language, both vocabulary behaviors, shortcuts and Undo. The Firefox ZIP remains an unsigned temporary add-on. Actual classic Outlook acceptance remains unverified; its companion EXE is an experimental prerelease. Previous releases are not replaced.
