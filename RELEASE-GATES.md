# Release gates — 6.2.0 community Windows release

This checklist describes release requirements, not proof that a draft has shipped.
The GitHub Release notes and linked Actions runs record the actual publication
evidence. SHA256 identifies the chosen binary; a local PASS is not hosted CI.

## Implemented and locally verified

- [x] Actual package/build/EXE identity and independently checked payload manifest.
- [x] Same-origin local HTTP write authorization; no LAN/public status exposure.
- [x] User-owned Tunnel ID/key configuration; current-user DPAPI persistence.
- [x] Public templates unbound; private state/auth/history are not packaged.
- [x] Known vulnerable upstream Tunnel dependencies repaired in an explicitly
  modified community build; source/commit/checksums/licenses included.
- [x] Pinned WebView2 SDK, Go toolchain and secret scanner restoration.
- [x] Independent Native list/detail and Scheduled Tasks reads; history retained.
- [x] Unit, tray, DOM/detail-scroll, installer and package-integrity tests.
- [x] Actual Windows WebView2 DOM startup and real Cloud discovery/read-only
  get_agent_list/get_capabilities against this candidate's owned Tunnel.
- [x] Three sequential owned-Tunnel restart/true-exit rounds; no native Codex stopped.
- [x] Reachable Git history reviewed with redacted secret scanning and one exact
  documented benign idempotency-key exception, not broad exclusions.

## Required before declaring a GitHub release published

- [x] Confirm exact repository, account permission, branch and public files.
- [x] Review sanitized source snapshot/diff, release notes and artifact hashes.
- [x] Windows CI passed on the approved v6.2.0 publication revision; later main
  documentation/test updates independently passed run 38027772261.
- [x] Verified source/Windows assets and checksum manifest published as v6.2.0.
- [x] Public release and downloaded hashes read back; no v6.2.0 asset replaced.

## Separate macOS preview gates (not inherited from Windows)

- [x] Real macOS 15 Intel / Apple Silicon CI: path, scopes, stdio catalog, lazy
  native adapter, private Keychain readback and three isolated child restarts.
- [x] Real Mac Chromium mounted DOM and independent Native detail scroll.
- [x] Architecture-matched Tunnel repair build, provenance, dependency licenses,
  known vulnerability scan and clean package manifest.
- [ ] Real macOS user/ChatGPT Cloud discovery and task acceptance. A fake executor
  smoke is labelled fake; it does not satisfy this gate.
- [ ] macOS packaged startup / Ctrl+C cleanup and interrupted recovery with real
  own Tunnel. No notarization is claimed; absent gate means preview, not stable.

Mac CI evidence: [PR validation 38030763299](https://github.com/parrettprasant-star/Local-Codex-Bridge/actions/runs/38030763299).
Both architectures passed; archive extraction preserved executable permission and
matched every payload hash. The adapter smoke explicitly uses a FAKE executor.
Do not convert these checked CI gates into a claim of real Mac Cloud acceptance.

The community package is **unsigned**. Do not label it signed, official, Store
approved, or universally provisioned. Code signing needs a real publisher
certificate; no certificate or account credentials are embedded or invented.

Secure MCP Tunnel is for private/developer access. A public ChatGPT Store app is
a separate deployment requiring its own public HTTPS endpoint/auth/review.
Future Work Agent, automatic routing and write/terminal permissions are not
enabled merely because provider metadata describes those capabilities.
