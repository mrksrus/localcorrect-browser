# 1.0.0-rc.1

First release candidate (not final 1.0).

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
unsupported complex/embedded rich editors, subframes and shadow DOM; synthetic
input may not integrate with all frameworks; first dictionary index is synchronous.
Firefox unsigned ZIP requires temporary loading or subsequent Mozilla signing.
Actual Firefox behavior and store acceptance are not verified. See README.
