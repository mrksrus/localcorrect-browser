# 1.0.0-rc.3 candidate

- Add 200 frozen email/paragraph examples and a separate 40-document blind audit,
  with exact document/edit/control scores and an offline HTML comparison.
- Expand EN/DE candidates with bounded lexical probes, noun/compound context,
  regional US/GB and DE/AT spelling data, and explicit source-casing evidence.
- Preserve recognized signatures, intentional literals and quoted labels; retain
  original LF/CRLF/CR offsets for reply/code protection.
- Prevent repeated words from bypassing casing and sentence-context guards via
  caches. Honorific/greeting frames protect names.
- Exercise all 200 primary documents in both modes through browser adapter/Undo
  and the native JavaScript/Jint runtime.

These are unsigned experimental packages. Firefox signing and actual classic
Outlook2019 device acceptance remain separate. Final original200 scores include
post-validation improvements; the additional40 audit was not used for tuning.
See QUALITY.md and the downloadable report for remaining errors and limits.

# 1.0.0-rc.2 candidate

- Add manual Alt+Shift+C correction and Alt+Shift+Z Undo commands, saved settings,
  editable Firefox shortcuts and background execution independent of popup lifetime.
- Capture the focused target before dictionary loading; reject changed content,
  selection, focus and replayed operations. Support focused same-origin frames.
- Report action failures through the toolbar badge/title and popup.
- Protect fenced code, backticks, paths, handles, flags, technical names and more
  identifiers; add narrow context rules for common initial EN/DE typos.
- Reduce lexical initialization memory using exact sorted-string lookup.
- Preserve a reproducible synthetic development/holdout comparison. See QUALITY.md.

This remains a spelling corrector with explicit rules. It does not perform
contextual grammar correction and does not guarantee error-free output.
Unsigned Firefox archives require temporary loading or Mozilla signing.

# 1.0.0-rc.1

First release candidate (not final 1.0).

Independent-review fixes (same RC designation):
- Mandatory broad offline EN/DE Hunspell validity/inflections via bundled nspell,
  independent of frequency ranking; preserves `versendet` and `protections`.
- Reject partial-token selections at either end in plain/rich fields, including
  inline joins and combining marks. Never expand selection to change extra text.
- German determiner-context titlecase candidates validated lexically; lower
  frequency floor only for adjacent-transposition noun-context edits.
- Unknown English titlecase names protected at selection/sentence start;
  dotted filenames protected; short words need high-frequency transpositions.
- Full-sentence independent acceptance retained alongside isolated-word metrics;
  complete upstream lexical source/notices, pinned hashes and offline rebuild.

- Shared synchronous @localcorrect/core API, original SymSpell symmetric-delete
  implementation, edit-distance validation and frequency/ambiguity ranking.
- Bundled English/German CC BY-SA frequency data with pinned provenance,
  source/output hashes, original notices and reproducible filtering script.
- Chrome/Firefox MV3 explicit-action correction, language/mode/UI language,
  selection/focused-field handling and guarded single-step Undo.
- Text-node-only inline rich-text changes, protected reply/signature paths,
  input/candidate limits and visible errors rather than destructive fallback.
- Synthetic quality and real Chromium DOM tests; deterministic local packages.

Known limits: no contextual grammar or real-word correction; corpus noise;
heuristic proper-name/signature recognition; some German noun typos skipped;
unsupported complex/embedded rich editors, cross-origin frames and shadow DOM; synthetic
input may not integrate with all frameworks; first dictionary index is synchronous.
Firefox unsigned ZIP requires temporary loading or subsequent Mozilla signing.
Actual Firefox behavior and store acceptance are not verified. See README.
