# Security

This release candidate changes selected or focused draft text only after
an explicit action. It has no cloud correction, telemetry, remotely loaded
code or permanent host permission. Background listeners accept only explicit
keyboard commands and same-extension popup actions; there is no typing listener.
Settings use extension storage.local, never document-text storage. It does not promise
perfect detection of names, signatures or all unsupported editors.

## Local inference and text lifetime

On an explicit correction, the page captures the supported editor and selection.
The selected text, or the focused field when no text is selected, passes to the
extension background for local BERT Mini inference. Dictionaries, the ONNX model
and ONNX Runtime Web 1.31.1 CPU/WASM code are bundled with the extension. Resource
requests use the extension's own URLs; document text is not sent in a request,
written to storage, logged or used for online training.

The model session is reused. Document text, tokens, inference buffers and scores
belong to the operation and are not retained as an inference cache. The page holds
a pending capture while the operation runs and clears it after completion or
cancellation. The page also retains one Undo snapshot until it is replaced,
undone or the document is discarded. These are in-memory copies, not secure memory
erasure guarantees. The host page, browser, operating system and other extensions
have their own access and retention behavior.

Before applying changes, LocalCorrect rechecks the captured editor's content,
selection and focus, plus the active tab and focused window. A mismatch or
inference failure aborts the operation without applying its corrections. Model
bytes are checked against the pinned SHA-256 and size. The correction policy must
match both the ONNX model and vocabulary/action metadata; invalid tensor shapes
or non-finite scores are rejected.

The permissions remain `activeTab`, `scripting` and `storage`. There is no
permanent all-sites grant or typing monitor. The extension-page Content Security
Policy allows scripts and connections only from `self`; `wasm-unsafe-eval` enables
the bundled WebAssembly runtime. It does not enable JavaScript `unsafe-eval`,
remote scripts or a remote correction endpoint.

## Applying and undoing edits

Never rely on automatic correction for passwords, addresses, legal/medical
accuracy or security-sensitive identifiers. Review the resulting text before
sending. Avoid invoking it on an editor that cannot tolerate synthetic input
notifications. Read-only/disabled/password and unsupported rich paths are rejected.
Undo uses exact post-operation snapshots and refuses stale content rather than
overwriting subsequent changes. No HTML string is inserted during correction.

For a security problem, use the repository's private GitHub vulnerability
reporting if enabled; otherwise open an issue with a nonsensitive description
asking for a private reporting route. Do not post real message text, credentials,
or private logs. Only synthetic fixtures belong in this repository.

No external penetration testing, live-mail verification or browser-store review
has been performed. ONNX Runtime Web is a bundled runtime dependency; esbuild,
Playwright and the dictionary compilers are build/test tools. `npm audit` is a
dependency advisory check, not a security certification. RC6 release validation,
quality results and CPU/RAM measurements are pending.
