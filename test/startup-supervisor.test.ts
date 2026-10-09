import assert from "node:assert/strict";
import test from "node:test";

import { StartupSupervisor } from "../src/startup-supervisor.js";

test("StartupSupervisor owns one generation and bounded component health", () => {
  const supervisor = new StartupSupervisor("generation-test");
  supervisor.component("Bridge Backend", "starting", { owner_pid: 101 });
  supervisor.transition("HOST_READY", "status server bound");
  supervisor.component("WebView2", "ready", { owner_pid: 101 });
  supervisor.transition("UI_READY", "Control Center DOM ready");
  supervisor.component("Tunnel", "failed", { failure_reason: "transport_closed" });
  supervisor.transition("DEGRADED", "Tunnel is unavailable; UI remains usable");

  const snapshot = supervisor.snapshot();
  assert.equal(snapshot.generation, "generation-test");
  assert.equal(snapshot.phase, "DEGRADED");
  assert.equal(snapshot.components["WebView2"]?.generation, "generation-test");
  assert.equal(snapshot.components.Tunnel?.state, "failed");
  assert.equal(snapshot.components.Tunnel?.failure_reason, "transport_closed");
  assert.equal(snapshot.timeline.length, 4);
});

test("new StartupSupervisor generations cannot reuse the previous identity", () => {
  const first = new StartupSupervisor();
  const second = new StartupSupervisor();
  assert.notEqual(first.generation, second.generation);
});
