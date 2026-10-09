# Third-party provenance and distribution

## WebView2 SDK

Pinned Microsoft.Web.WebView2 NuGet version: **1.0.4129.50**.

Official package:
https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4129.50/microsoft.web.webview2.1.0.4129.50.nupkg

SHA256 independently measured from that HTTPS download on 2026-10-10:
`D3934F482D484B89FB4825DF720C710664E1143A1E90F7B3A60794EF33F473D2`.
This is a pinned locally verified checksum, not a claim of an upstream-signed hash.

`scripts/restore-webview2.ps1` restores only the required .NET Framework/x64 SDK
files into a fresh directory, verifies the archive, and preserves the archive's
LICENSE.txt and NOTICE.txt verbatim. `build-review-package.ps1` includes those
notices. An existing source `lib` directory is never overwritten by the restore.

The installed WebView2 browser runtime is a separate dependency. Do not publish
`*.exe.WebView2`, EBWebView profiles, user data or browser cache.

## Secure MCP Tunnel client

Upstream: https://github.com/openai/tunnel-client (Apache-2.0; upstream LICENSE and
NOTICE apply). The project's MIT license does not replace those notices or its
dependency obligations. For a public binary release, bind the exact executable
to an official release/checksum and preserve matching release notices/sidecars.
The existing local 0.0.11 binary is NOT automatically distribution-approved merely
because the current upstream repository has an open-source license.

Source snapshots exclude tunnel-client.exe. Review packaging omits it by default;
an explicit TunnelDirectory enables a LOCAL TEST copy only. No binary signing,
publication or supply-chain certification is performed by this preparation.

## Dependency-repair runtime build (6.2.0 release candidate)

The public v0.0.16 runtime's published vulnerability report and a current
govulncheck binary-symbol scan found outdated dependencies/Go standard library.
It must not be treated as clean merely because it is the latest signed upstream
release. `scripts/build-hardened-tunnel.ps1` builds an explicitly **modified**
community runtime, not a byte-identical official release:

- Official v0.0.16 narrow runtime source archive SHA256:
  `88953678325FFE650CC562BBD0B147E7E8E984B0527AA8B1647B02D6660CE9E0`.
- Source commit `5f99daabd4aa4a77049e6d81d54a0d8c18335397`.
- Go 1.27.2; `golang.org/x/net` v0.60.0; OpenTelemetry core/SDK v1.45.0.
- No upstream Go implementation, MCP protocol or Bridge lifecycle code rewritten.
- Version `0.0.16-lcb.1`, explicit provenance JSON and actual binary module inventory.
- Known-vulnerability check: pinned govulncheck v1.8.0, binary symbol scan; a
  nonzero exit blocks packaging. Database changes may require a future rebuild.
- Matching upstream Apache LICENSE/NOTICE, Go license and each linked dependency's
  actual module license/notice are included. The binary is unsigned, not an official
  OpenAI binary, and upstream signature/provenance does not certify its rebuilt bytes.

```powershell
./scripts/build-hardened-tunnel.ps1 -GoExecutable C:\Tools\go\bin\go.exe -WorkDirectory C:\Build\TunnelWork -OutputDirectory artifacts/TunnelRepair
./scripts/build-release-package.ps1 -WebViewSdkDirectory .staging/sdk-clean -TunnelDirectory artifacts/TunnelRepair -OutputDirectory artifacts/Release1
```

Do not confuse a clean known-vulnerability scan with a security guarantee or
independent penetration test. Review the changed dependency versions and actual
runtime compatibility before promotion. Never ship the build cache/private logs.

## Node.js / Codex

Independently installed prerequisites, not redistributed by this project. Keep
their own licenses/authentication separate. No Codex credentials or histories are
included. npm dependencies are pinned by package-lock.json; use npm ci.
