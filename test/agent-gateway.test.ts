import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { AppServerManager } from "../src/app-server.js";
import { CodexAppServerAdapter } from "../src/app-server-adapter.js";
import {
  AgentGateway,
  AgentRegistry,
  CodexAgentProviderAdapter,
} from "../src/agent-gateway.js";
import { CodexTaskSync } from "../src/codex-task-sync.js";
import { ModelGuard } from "../src/model-guard.js";
import { RuntimeStore } from "../src/runtime.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskRuntime } from "../src/task-runtime.js";
import { ControlSurface } from "../src/tools.js";

const fakeCodex = fileURLToPath(new URL("./fake-codex.mjs", import.meta.url));

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("Agent Gateway registers Codex Agent and returns task status plus Result Manifest", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-agent-gateway-"));
  const appServer = new AppServerManager(undefined, {
    executable: process.execPath,
    prefixArgs: [fakeCodex],
    requestTimeoutMs: 2_000,
  });
  const manager = new TaskManager(join(directory, "tasks.json"));
  const taskRuntime = new TaskRuntime(manager);
  const sync = new CodexTaskSync(appServer.runtime, manager, taskRuntime);
  const adapter = new CodexAppServerAdapter(appServer);
  const modelGuard = new ModelGuard();
  let control = new ControlSurface(appServer, undefined, modelGuard, undefined, adapter);
  const provider = new CodexAgentProviderAdapter(
    (argumentsValue) => control.callForPlugin("codex_turn", argumentsValue),
    manager,
    appServer.runtime,
    () => appServer.status(),
  );
  const gateway = new AgentGateway(
    manager,
    appServer.runtime,
    new AgentRegistry([provider]),
  );
  control = new ControlSurface(appServer, undefined, modelGuard, undefined, adapter, gateway);

  try {
    const providers = gateway.registry.list();
    assert.deepEqual(providers.map((candidate) => candidate.id), ["codex_local"]);
    assert.equal(providers[0]?.type, "codex");
    assert.equal(providers[0]?.status, "ready");
    assert.deepEqual(providers[0]?.capabilities, [
      "file_read",
      "file_write",
      "terminal",
      "code_execution",
    ]);

    const created = await control.callForPlugin("create_agent_task", {
      instruction: "只回复 AGENT_GATEWAY_OK，不执行命令，不修改文件。",
      cwd: "D:\\Bridge",
      title: "Agent Gateway smoke",
    }) as Record<string, unknown>;
    assert.equal(created.accepted, true);
    assert.equal(created.agent_id, "codex_local");
    assert.equal(typeof created.task_id, "string");
    assert.equal(typeof created.thread_id, "string");
    assert.equal(typeof created.turn_id, "string");
    assert.equal((created.result_manifest as Record<string, unknown>)?.task_id, created.task_id);

    const taskId = created.task_id as string;
    assert.equal(manager.get(taskId).cwd, "D:\\Bridge");
    const initial = gateway.getTaskStatus({ task_id: taskId }) as Record<string, unknown>;
    assert.equal(initial.task_id, taskId);
    assert.equal(initial.agent_id, "codex_local");
    assert.equal(typeof initial.status, "string");
    assert.equal((initial.result_manifest as Record<string, unknown>)?.thread_id, created.thread_id);

    await delay(40);
    const observed = await control.callForPlugin("codex_observe", {
      thread_id: created.thread_id,
      cursor: 0,
      limit: 20,
    }) as Record<string, unknown>;
    const pending = (observed.pending_requests as Array<Record<string, unknown>>)[0];
    if (pending) {
      await control.callForPlugin("codex_respond", {
        request_id: pending.request_id,
        thread_id: pending.thread_id,
        turn_id: pending.turn_id,
        method: pending.method,
        decision: "decline",
      });
    }
    await delay(50);

    const completed = gateway.getTaskStatus({ task_id: taskId }) as Record<string, unknown>;
    assert.equal(completed.status, "completed");
    const manifest = completed.result_manifest as Record<string, unknown>;
    assert.equal(manifest.task_id, taskId);
    assert.equal(manifest.execution_status, "DONE");
    assert.equal(manifest.result_summary, "FAKE_FINAL");
    assert.equal(manifest.review_status, "READY");
    assert.ok(Number.isFinite(Date.parse(manifest.started_at as string)));
    assert.ok(Number.isFinite(Date.parse(manifest.completed_at as string)));
    assert.ok(Date.parse(manifest.completed_at as string) >= Date.parse(manifest.started_at as string));
    assert.deepEqual(manifest.output_files, []);
    const persisted = new TaskManager(join(directory, "tasks.json")).get(taskId);
    assert.equal(persisted.completed_at, manifest.completed_at);
    assert.equal(persisted.result_manifest.review_status, "READY");
  } finally {
    sync.close();
    await appServer.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Agent Gateway rejects unavailable provider without starting Codex", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-agent-gateway-"));
  const manager = new TaskManager(join(directory, "tasks.json"));
  const gateway = new AgentGateway(
    manager,
    new RuntimeStore(),
    new AgentRegistry(),
  );
  try {
    const result = await gateway.createAgentTask({
      agent_id: "work_agent",
      instruction: "test",
      cwd: "D:\\Bridge",
    }) as Record<string, unknown>;
    assert.equal(result.accepted, false);
    assert.equal(result.status, "rejected");
    assert.equal(manager.snapshot().tasks.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
