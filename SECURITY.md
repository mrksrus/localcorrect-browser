# Security

This release candidate changes user-selected or focused draft text only after
an explicit action. It has no network correction, telemetry, remotely loaded
code or permanent host permission. Background listeners accept only explicit
keyboard commands and same-extension popup actions; there is no typing listener.
Settings use extension storage.local, never document-text storage. It does not promise
perfect detection of names, signatures or all unsupported editors.

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
has been performed. Dependencies are build/test only; `npm audit` is a dependency
advisory check, not a security certification.
