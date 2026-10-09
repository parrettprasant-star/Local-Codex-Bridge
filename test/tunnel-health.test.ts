import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { probeTunnelHealth, readTunnelHealth } from "../src/tunnel-health.js";

const stateFileEnvironment = "LOCAL_CODEX_BRIDGE_TUNNEL_STATE_FILE";
const tunnelIdEnvironment = "LOCAL_CODEX_BRIDGE_TUNNEL_ID";

test("tunnel health fails closed without a configured V6 state file", () => {
  const originalState = process.env[stateFileEnvironment];
  const originalId = process.env[tunnelIdEnvironment];
  delete process.env[stateFileEnvironment];
  delete process.env[tunnelIdEnvironment];
  try {
    assert.deepEqual(readTunnelHealth(), {
      status: "not_configured",
      registration: "not_registered",
      active_tunnel_id: null,
      client_version: null,
      last_registration_error: null,
      health_url: null,
      parent_pid: null,
      mcp_child_pid: null,
      parent_process_alive: null,
      mcp_child_alive: null,
      health_probe: "unknown",
      transport_status: "unknown",
      transport_last_error: null,
      restart_attempt: null,
      last_initialize_at: null,
      last_tools_list_at: null,
      last_disconnect_reason: null,
      state_updated_at: null,
    });
  } finally {
    if (originalState === undefined) delete process.env[stateFileEnvironment];
    else process.env[stateFileEnvironment] = originalState;
    if (originalId === undefined) delete process.env[tunnelIdEnvironment];
    else process.env[tunnelIdEnvironment] = originalId;
  }
});

test("tunnel health exposes only bounded non-secret registration state", () => {
  const root = mkdtempSync(join(process.cwd(), ".staging", "tunnel-health-test-"));
  const stateFile = join(root, "tunnel-state.json");
  const originalState = process.env[stateFileEnvironment];
  delete process.env[tunnelIdEnvironment];
  process.env[stateFileEnvironment] = stateFile;
  writeFileSync(stateFile, JSON.stringify({
    status: "running",
    registration: "ready",
    tunnel_id: "tunnel_00000000000000000000000000000000",
    client_version: "0.0.11",
    health_url: "http://127.0.0.1:14792",
    last_error: "",
    api_key: "must-not-be-exposed",
  }), "utf8");
  try {
    assert.deepEqual(readTunnelHealth(), {
      status: "running",
      registration: "ready",
      active_tunnel_id: "tunnel_00000000000000000000000000000000",
      client_version: "0.0.11",
      last_registration_error: null,
      health_url: "http://127.0.0.1:14792",
      parent_pid: null,
      mcp_child_pid: null,
      parent_process_alive: null,
      mcp_child_alive: null,
      health_probe: "unknown",
      transport_status: "unknown",
      transport_last_error: null,
      restart_attempt: null,
      last_initialize_at: null,
      last_tools_list_at: null,
      last_disconnect_reason: null,
      state_updated_at: null,
    });
  } finally {
    if (originalState === undefined) delete process.env[stateFileEnvironment];
    else process.env[stateFileEnvironment] = originalState;
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale running/ready state fails closed when the recorded parent or MCP child is gone", async () => {
  const root = mkdtempSync(join(process.cwd(), ".staging", "tunnel-health-stale-test-"));
  const stateFile = join(root, "tunnel-state.json");
  const originalState = process.env[stateFileEnvironment];
  const originalId = process.env[tunnelIdEnvironment];
  delete process.env[tunnelIdEnvironment];
  process.env[stateFileEnvironment] = stateFile;
  writeFileSync(stateFile, JSON.stringify({
    status: "running",
    registration: "ready",
    tunnel_id: "tunnel_00000000000000000000000000000000",
    client_version: "0.0.11",
    health_url: "http://127.0.0.1:1",
    process_id: 2147483647,
    parent_pid: 2147483647,
    mcp_child_pid: 2147483646,
    transport_status: "ready",
  }), "utf8");
  try {
    const resolved = await probeTunnelHealth(readTunnelHealth());
    assert.equal(resolved.status, "error");
    assert.equal(resolved.registration, "failed");
    assert.equal(resolved.health_probe, "failed");
    assert.equal(resolved.last_registration_error, "tunnel_parent_not_alive");
    assert.equal(resolved.parent_process_alive, false);
  } finally {
    if (originalState === undefined) delete process.env[stateFileEnvironment];
    else process.env[stateFileEnvironment] = originalState;
    if (originalId === undefined) delete process.env[tunnelIdEnvironment];
    else process.env[tunnelIdEnvironment] = originalId;
    rmSync(root, { recursive: true, force: true });
  }
});
