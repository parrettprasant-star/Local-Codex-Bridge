import assert from "node:assert/strict";
import test from "node:test";

import { StartupSupervisor } from "../src/startup-supervisor.js";

const faults = [
  "host-delayed",
  "host-start-failed",
  "webview-init-failed",
  "webview-renderer-crashed",
  "dom-not-ready",
  "tunnel-parent-exited",
  "mcp-child-exited",
  "stale-tunnel-state",
  "stale-port-state",
  "node-child-exited",
  "plugin-disconnected",
  "codex-start-failed",
  "network-unavailable",
  "runtime-unavailable",
];

test("fault injection keeps the UI phase independent from failed capabilities", () => {
  for (const fault of faults) {
    const supervisor = new StartupSupervisor(`fault-${fault}`);
    supervisor.transition("HOST_READY", "status host is available");
    supervisor.transition("UI_READY", "Control Center shell is visible");
    supervisor.component("Control Center Host", "ready", { owner_pid: 1 });
    supervisor.component("Backend", "degraded", { failure_reason: fault });
    supervisor.transition("DEGRADED", fault);
    const snapshot = supervisor.snapshot();
    assert.equal(snapshot.phase, "DEGRADED", fault);
    assert.equal(snapshot.components["Control Center Host"]?.state, "ready", fault);
    assert.equal(snapshot.components.Backend?.failure_reason, fault, fault);
  }
});
