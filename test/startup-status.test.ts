import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { McpHealthState } from "../src/mcp-health.js";
import { ModelGuard } from "../src/model-guard.js";
import { PortRegistry } from "../src/port-registry.js";
import { StartupSupervisor } from "../src/startup-supervisor.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskRuntime } from "../src/task-runtime.js";
import { TaskStatusServer } from "./browser-safe-status-server.js";
import { TaskStatusStore } from "../src/task-status.js";

test("status shell is available before backend capabilities are ready", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-startup-status-"));
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const runtime = new TaskRuntime(manager);
  const supervisor = new StartupSupervisor("startup-test");
  const registry = new PortRegistry(join(directory, "run", "status-url.json"), supervisor.generation);
  const server = new TaskStatusServer(statusStore, manager, runtime, {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    portRegistry: registry,
    startupSupervisor: supervisor,
  });
  try {
    const address = await server.start();
    assert.ok(address.port >= 49_152, "isolated HTTP fixture must use a browser-safe test port");
    const app = await fetch(`http://127.0.0.1:${address.port}/app`);
    assert.equal(app.status, 200);
    assert.match(await app.text(), /Control Center/);
    const status = await (await fetch(`http://127.0.0.1:${address.port}/api/status`)).json() as Record<string, any>;
    assert.equal(status.startup.generation, "startup-test");
    assert.equal(status.startup.phase, "HOST_READY");
    assert.equal(registry.read()?.port, address.port);
  } finally {
    await server.close();
    assert.equal(registry.read()?.state, "stopped");
    rmSync(directory, { recursive: true, force: true });
  }
});
