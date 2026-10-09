# 6.2.0 — Windows community release

Unsigned community build, not an official OpenAI product. Publication status and
downloads are listed on this repository's GitHub Releases page. No user
credentials/history are included.

## Included

- Control Center: Overview, Native Threads, AGENTS, Scheduled Tasks, Diagnostics.
- 13 MCP tools, retaining all seven native Codex tools alongside Agent Gateway
  and Project Registry discovery.
- Real owned-native-turn visibility, terminal clearing, paginated large history
  reads, and an independent scrollable native detail body.
- Ephemeral AGENTS recovery/action gating and bounded Result Manifests.
- WebView2 initialization/fallback recovery, stable short-path operation, tray,
  single instance, true exit and scoped cleanup.

## Release hardening

- Per-user Tunnel ID/key setup, DPAPI persistence and command-path quoting.
- Pre-spawn Tunnel failures now become failed state instead of stale Starting.
- Same-origin loopback write authorization and CSRF/DNS-rebinding regression tests.
- Unified actual package/EXE/build identity; hashes and strict payload verification.
- Idempotent shortcut installer with explicit replacement opt-in and backup.
- Runtime event start/terminal timestamps persist; text-only native results are
  finalized as review-ready without inventing output files or marking user review.
- Explicit dependency-repair Tunnel build (0.0.16-lcb.1); unchanged upstream Go
  implementation sources, repaired module versions, provenance and license set.
- Clean source export and checksum-pinned Windows build/security CI.
- Chinese beginner installation, usage, troubleshooting, upgrade/rollback and
  privacy manuals, with copyable ChatGPT prompts and a local install.cmd wrapper.
- Windows PowerShell 5.1/7 installer and manifest compatibility; existing shortcut
  conflicts remain opt-in and no automatic startup entry is added.

## Prerequisites and scope

Windows x64, Node 24+, official Codex CLI/auth and WebView2 Runtime remain
independently installed. ChatGPT access needs the user's own valid private
Tunnel registration/key. The Agent Gateway enables project-scoped file_read;
file_write, terminal and code_execution remain gated. No Work Agent is included.

Scheduled Tasks is a read-only local automation view, not every ChatGPT cloud
task. The host is not an OS security sandbox. Read SECURITY.md, THIRD-PARTY.md,
TUNNEL-SETUP.md and RELEASE-GATES.md before public deployment.

Upgrade/rollback never delete .codex, sessions/history or Bridge AppData. Retain
the old package until real startup, Cloud connectivity and true exit succeed.
