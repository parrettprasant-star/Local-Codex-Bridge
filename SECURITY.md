# Security limitations and release blockers

This snapshot is suitable for developer review, not untrusted multi-user hosting.

## Trust boundary

Bridge inherits the local user's process environment. Native Codex sandbox and
approval policies are the execution boundary; prompts and capability labels are
not an OS sandbox. A cwd filter on thread/list is not thread access control.
Project Registry path validation is not a full multi-tenant authorization system.

## Local HTTP browser protection

An isolated test of the previous status server accepted a mutation with a foreign
Host/Origin and `text/plain` JSON. A fake task executor was used; no actual Codex
task or user file was changed. This establishes missing server-side validation,
not a demonstrated browser exploit.

The new review source validates exact Host/Origin and fetch-site, denies CORS,
requires JSON for mutation bodies, and requires a random per-listener authorization
token for every mutation. Both UIs attach it, and trusted local CLI clients have
an explicit bootstrap. Restart invalidates old tokens. Tests cover denied requests
before mutation plus authorized UI/CLI, bodyless controls and stale replay.
See LOCAL-HTTP.md. This is a browser/CSRF boundary, NOT hostile local-process
authentication. Do not claim loopback binding alone provides authentication.

## Never publish

Runtime keys, auth.json, config.toml, .env files, DPAPI payloads, sessions/history,
task stores, project registries, Tunnel profiles/IDs, WebView2 cache, logs and
private browser screenshots must remain outside source/release archives.

Pattern scans and `npm audit` are useful but not a proof that all secrets are absent.
Review the full Git history and the exact staged diff before approving a push.
Do not report a vulnerability with private credentials or session text attached.

## Transport

Use only the existing trusted per-user registration. Do not add a random public
proxy or weaken approval to make the connection work. A local catalog PASS is not
a new real ChatGPT Cloud end-to-end PASS.
