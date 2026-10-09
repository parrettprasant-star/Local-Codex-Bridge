# Current architecture and boundaries

```text
ChatGPT / MCP client
  -> per-user remote Tunnel -> owned local MCP child -> 13-tool facade
                                                   -> native Codex app-server
                                                   -> persistent native history

Windows WebView2 host -> desktop Node / loopback Control Center
  -> shared read model / bounded native history reads
  -> AGENTS scheduler -> isolated codex exec --ephemeral --json
```

The desktop Node and Tunnel MCP child are different runtime instances. Active
native-turn projection needs verified child identity/liveness, not a stale UI
projection file. Observe is not a new execution task. Native terminal turns are
removed from the active view without deleting history.

AGENTS tasks remain ephemeral; process loss is not a resumable conversation.
Queued tasks are not active. Recovery-required tasks require a real legal exit.
Task state, output references and Result Manifests are Bridge data, not a copy of
native Codex transcripts.

Native thread lists are bounded; details load paginated history on demand.
Scheduled Tasks is an independent read-only view, not a Native Thread source.
The initial Agent Gateway adapts existing Codex control, not another scheduler.

Lifecycle belongs to the existing Windows host. Tests may stop only their own
identified child processes. No test may clean up by `node.exe` or `codex.exe` name.
The public-source preparation does not redesign mutex, tray, ownership or shutdown.
