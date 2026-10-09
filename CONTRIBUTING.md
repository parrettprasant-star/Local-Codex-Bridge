# Contributing

This is a Windows developer-preview project. Prefer narrow evidence-backed fixes.
Do not run execution/cleanup smoke against someone else's live Bridge or Codex.

Before a change, read AGENTS.md, the adapter and its callers. Preserve the
persistent Native / ephemeral AGENTS separation, scheduler policy, scoped process
ownership, tray/true-exit semantics and read-only Scheduled Tasks adapter.

Required local checks:

```powershell
npm ci
npm run typecheck
npm test
npm run smoke:catalog
npm run test:control-center-dom
npm run test:control-center-native-detail
git diff --check
```

Use build:staging while a package may be running. Discovery smoke creates no
real tasks. Execution/turn tests need an isolated explicit test workspace and
human authorization; acceptance is not completion or verified file output.

For desktop changes, restore the pinned SDK into a fresh directory, build a short
review package, and verify actual WebView DOM readiness plus owned-process cleanup.
HTTP 200, process exit 0 and a screenshot of a different bundle are not proof.
Never disable the HTTP authorization guard to keep a legacy script working.

Attach a minimal redacted reproduction, affected-file list and exact check results.
Do not commit local profiles, keys, AppData, .codex, caches, logs, executables or
private screenshots. If a security report would expose those, contact the
maintainer privately (use GitHub private reporting only when enabled).

Review only the intended diff before committing. Publishing, replacing a user's
formal package or switching their desktop entry are separate explicit operations.
