import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  isBridgeOwnedNativeProjectionHost,
  readBridgeOwnedNativeActiveTasks,
  type BridgeOwnedNativeTaskSource,
} from "../src/bridge-owned-native-tasks.js";
import { RuntimeStore } from "../src/runtime.js";
import { TaskManager } from "../src/task-manager.js";

const readyTunnel = {
  status: "running" as const,
  registration: "ready" as const,
};

function writeTunnelOwnership(root: string, pid = process.pid): void {
  const runRoot = join(root, "run");
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(join(runRoot, "tunnel-state.json"), JSON.stringify({
    schemaVersion: 1,
    status: "running",
    registration: "ready",
    process_id: pid,
  }), "utf8");
  writeFileSync(join(runRoot, "tunnel-client.pid"), String(pid), "utf8");
  writeFileSync(join(runRoot, "desktop-ownership.json"), JSON.stringify({
    tunnel: {
      role: "tunnel",
      pid,
      executable_path: join(root, "tunnel-client.exe"),
      profile: join(runRoot, "tunnel-profile.yaml"),
    },
  }), "utf8");
}

function sourceFor(
  root: string,
  isProcessAlive?: (pid: number) => boolean,
  pluginRuntimeIsLive: () => Promise<boolean> = async () => true,
): BridgeOwnedNativeTaskSource {
  writeTunnelOwnership(root);
  return {
    taskFilePath: join(root, "tunnel-bridge", "task_records.json"),
    tunnelStateFilePath: join(root, "run", "tunnel-state.json"),
    ownershipFilePath: join(root, "run", "desktop-ownership.json"),
    pidFilePath: join(root, "run", "tunnel-client.pid"),
    expectedPackageRoot: root,
    hostStatusPort: 37_931,
    isProcessAlive: isProcessAlive ?? ((pid) => pid === process.pid),
    pluginRuntimeIsLive,
  };
}

test("only a live V6 plugin runtime projects its owned active Native turns", async () => {
  const root = mkdtempSync(join(tmpdir(), "local-codex-bridge-owned-native-"));
  try {
    const taskFile = join(root, "tunnel-bridge", "task_records.json");
    const manager = new TaskManager(taskFile);
    const owned = manager.create({
      name: "ChatGPT Native turn",
      fingerprint: "runtime:thread-owned:turn-owned",
      execution_source: "external/native",
      status: "RUNNING",
      thread_id: "thread-owned",
      turn_id: "turn-owned",
      worker_id: null,
      active: true,
    });
    manager.create({
      name: "Non-Bridge native turn",
      fingerprint: "runtime:thread-foreign:turn-foreign",
      execution_source: "external/native",
      status: "RUNNING",
      thread_id: "thread-foreign",
      turn_id: "turn-foreign",
      worker_id: "native-desktop",
      active: true,
    });
    manager.create({
      name: "Bridge task with native-looking fields",
      fingerprint: "runtime:thread-bridge:turn-bridge",
      execution_source: "bridge",
      status: "RUNNING",
      thread_id: "thread-bridge",
      turn_id: "turn-bridge",
      active: true,
    });
    const source = sourceFor(root, (pid) => pid === process.pid);
    assert.equal(isBridgeOwnedNativeProjectionHost(join(root, "ui-tasks.json"), source), true);
    assert.equal(isBridgeOwnedNativeProjectionHost(source.taskFilePath, source), false);
    assert.equal(existsSync(join(root, "tunnel-bridge", "ux-projection.json")), false);
    const projected = await readBridgeOwnedNativeActiveTasks(source, readyTunnel);
    assert.deepEqual(projected.map((task) => task.id), [owned.id]);

    assert.deepEqual(
      await readBridgeOwnedNativeActiveTasks(sourceFor(root, undefined, async () => false), readyTunnel),
      [],
    );
    assert.deepEqual(
      await readBridgeOwnedNativeActiveTasks(source, { status: "stopped", registration: "not_registered" }),
      [],
    );
    assert.deepEqual(
      await readBridgeOwnedNativeActiveTasks(sourceFor(root, () => false), readyTunnel),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("completed, failed, and interrupted plugin turns disappear without a new observe task", async () => {
  const root = mkdtempSync(join(tmpdir(), "local-codex-bridge-native-terminals-"));
  try {
    for (const terminalStatus of ["COMPLETED", "FAILED", "INTERRUPTED"] as const) {
      const statusRoot = join(root, terminalStatus);
      const taskFile = join(statusRoot, "tunnel-bridge", "task_records.json");
      const manager = new TaskManager(taskFile);
      const task = manager.create({
        name: terminalStatus,
        fingerprint: `runtime:thread-${terminalStatus}:turn-${terminalStatus}`,
        execution_source: "external/native",
        status: "RUNNING",
        thread_id: `thread-${terminalStatus}`,
        turn_id: `turn-${terminalStatus}`,
        worker_id: null,
        active: true,
      });
      manager.update(task.id, { status: terminalStatus });
      const source = sourceFor(statusRoot, () => true);
      assert.deepEqual(await readBridgeOwnedNativeActiveTasks(source, readyTunnel), []);
    }

    const observeManager = new TaskManager(join(root, "observe", "task_records.json"));
    const runtime = new RuntimeStore();
    runtime.ensureThread("observe-only-thread");
    assert.equal(runtime.observe("observe-only-thread", undefined, 1)?.active_turn_id, null);
    assert.equal(observeManager.snapshot().tasks.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
