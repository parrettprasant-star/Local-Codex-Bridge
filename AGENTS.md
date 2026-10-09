# Contributor boundaries

Use current source/tests as truth. This development snapshot exposes 13 MCP tools;
preserve the original native-tool meanings and do not count observe as execution.

Do not modify native Codex installation, auth, sessions/history or automation DBs.
Use isolated test stores and exact child process identities. Live persistent-thread
tests require deliberate authorization. Normal deterministic tests must not need
user credentials or a running Tunnel.

Keep Node stdout pure JSON-RPC. Operational logs go to redacted stderr.
Bridge is not an OS sandbox; do not widen execution permissions for convenience.

Run typecheck, staging tests, result-contract restart tests and discovery-only smoke
after relevant changes. A 200 response is not Control Center DOM readiness.
Public desktop packaging remains gated by SECURITY.md and RELEASE-GATES.md.
