# Private ChatGPT connection setup

This is community software, not an official OpenAI product. Follow the current
[official Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and [official tunnel-client onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md).

## Important distribution boundary

Publishing Bridge source on GitHub is not publishing a ChatGPT public plugin.
Secure MCP Tunnel supports private MCP connections/developer testing, not public
plugin submission or distribution. Public plugins require a stable public HTTPS
MCP endpoint and suitable authentication. Do not share one maintainer-owned Tunnel
among all installations; this snapshot does not implement multi-user public hosting.

## Per-user prerequisites

1. Independently install Node.js 24+ and official Codex; use your own authentication.
2. Create/manage your own Tunnel endpoint in Platform Tunnel settings. Creating it
   requires Tunnels Read + Manage; running/selecting it requires Read + Use.
3. Ensure your ChatGPT workspace permits adding/using custom MCP servers. ChatGPT
   workspace access and Platform Tunnel permissions are separate requirements.
4. Use the verified bundled tunnel-client or a separately verified official release
   for your Windows architecture. Review its checksum/version/provenance; do not
   download a replacement from an unofficial mirror.
5. Use a short writable package directory and install Microsoft WebView2 Runtime.
   Ordinary users do not need the SDK; SDK restoration is a developer build step.

The review package has `tunnel_id: "tunnel_UNCONFIGURED"`, not a usable registration.
Keep the public template unchanged; enter your own ID in the desktop configuration
field below. The existing host validates the legacy `tunnel_` + 32 lower-case hex format. Newer
namespaced IDs are an explicit compatibility limitation; do not strip a namespace
or invent an ID. No silent Tunnel-client upgrade is performed by these build scripts.

Use the existing host's Runtime API Key setup/DPAPI mechanism for a runtime key;
never put a secret in a tracked template, screenshot, source archive or GitHub issue.
Leave `__MCP_COMMAND__` intact in the template: the host resolves it when generating
the owned runtime profile. The profile references `env:CONTROL_PLANE_API_KEY`.
Do not copy a maintainer profile or credentials into someone else's installation.

## Desktop configuration (6.2.0)

Tray → configuration provides a separate **your Tunnel ID** field and a masked
Runtime API Key field. Save your legacy `tunnel_` + 32 lowercase hex ID there;
it is kept in your private `desktop-settings.json`, not edited into the public
template. The key is encrypted with Windows CurrentUser DPAPI. Cancel and invalid
input do not save a key or close the configuration dialog as if successful.

The bundled runtime, when present, is preferred by default. A separately
verified official client can be selected by executable path. Missing paths are
rejected on save. Node and MCP entry paths are independently quoted, including
spaces. Reopening or upgrading the package does not require editing YAML.
Save, true-exit and restart so existing owned lifecycle startup uses this config.

Never supply somebody else's Tunnel ID/key. Account provisioning and permission
availability belong to OpenAI; Bridge cannot bypass them. Only one active stdio
client per ID is supported. This version's desktop ID input intentionally accepts
the validated legacy form; namespaced aliases are not advertised as supported.

## Verification ladder

- Local discovery: `npm run smoke:catalog` runs an isolated MCP child and verifies
  initialize, all 13 tools, get_agent_list and get_capabilities; it starts no Codex task.
- Network: the client opens outbound HTTPS to `api.openai.com:443` (or the separately
  configured mTLS control plane). The host is not expected to curl an internal Gateway.
- Owned runtime: parent/child identity, registration, health and transport must be
  live, not merely saved Ready JSON. See Diagnostics, with no credentials attached.
- Real Cloud acceptance: ChatGPT must actually deliver initialize/tools/list to this
  owned runtime and receive 13 tools. Local discovery alone is not this acceptance.

No setup command in this preparation creates cloud registrations, recreates a
ChatGPT App, changes VPN/DNS, switches the desktop shortcut or starts a Codex turn.
