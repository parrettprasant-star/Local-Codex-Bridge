import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AppServerManager } from "../src/app-server.js";
import { CodexAppServerAdapter } from "../src/app-server-adapter.js";
import { ModelGuard } from "../src/model-guard.js";
import { RuntimeStore } from "../src/runtime.js";
import { Scheduler } from "../src/scheduler.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskService } from "../src/task-service.js";
import { ControlSurface } from "../src/tools.js";

test("MCP-compatible codex_turn submission is thin and idempotent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-task-service-"));
  try {
    const manager = new TaskManager(join(directory, "tasks.json"));
    const adapter = {
      async initialize() {},
      async modelList() { return []; },
      async threadStart() { throw new Error("must not start for high complexity guard"); },
      async threadResume() { throw new Error("not used"); },
      async threadRead() { throw new Error("not used"); },
      async turnStart() { throw new Error("not used"); },
      async turnInterrupt() { return {}; },
      health() { return { status: {} as never, model_catalog: "unknown", last_model_catalog_at: null, last_error: null }; },
    } as unknown as CodexAppServerAdapter;
    const scheduler = new Scheduler(manager, adapter, new ModelGuard({ requireCatalog: true }), new RuntimeStore());
    const service = new TaskService(scheduler);
    const control = new ControlSurface(new AppServerManager(undefined, { executable: "unused" }), undefined, new ModelGuard(), service);
    const first = await control.call("codex_turn", {
      text: "safe duplicate submission",
      cwd: "C:\\Bridge",
      title: "稳定任务标题",
      idempotency_key: "client-retry-key",
      task_complexity: "high",
    }) as Record<string, unknown>;
    const second = await control.call("codex_turn", {
      text: "safe duplicate submission",
      cwd: "C:\\Bridge",
      idempotency_key: "client-retry-key",
      task_complexity: "high",
    }) as Record<string, unknown>;
    assert.equal(first.accepted, true);
    assert.equal(second.deduplicated, true);
    assert.equal(first.task_id, second.task_id);
    assert.equal(first.execution_mode, "queued");
    assert.equal(first.task_title, "稳定任务标题");
    assert.equal(scheduler.store.get(String(first.task_id)).execution_source, "bridge");
    const resultRead = await control.call("codex_observe", { task_id: String(first.task_id) }) as Record<string, unknown>;
    assert.equal(resultRead.task_id, first.task_id);
    assert.equal(resultRead.review_status, "NOT_READY");
    assert.equal(resultRead.resume_command, null);
    assert.equal((resultRead.result_manifest as Record<string, unknown>).task_title, "稳定任务标题");
    scheduler.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("TaskService refuses external/native continuation without an explicit thread_id", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-native-continuation-"));
  try {
    const manager = new TaskManager(join(directory, "tasks.json"));
    const adapter = {
      async initialize() {},
      async modelList() { return []; },
      async threadStart() { throw new Error("must not start an external/native continuation"); },
      async threadResume() { throw new Error("must not resume an external/native continuation"); },
      async threadRead() { throw new Error("must not inspect an external/native continuation"); },
      async turnStart() { throw new Error("must not start a turn"); },
      async turnInterrupt() { return {}; },
      health() { return { status: {} as never, model_catalog: "unknown", last_model_catalog_at: null, last_error: null }; },
    } as unknown as CodexAppServerAdapter;
    const scheduler = new Scheduler(manager, adapter, new ModelGuard(), new RuntimeStore());
    const task = manager.create({
      name: "原生线程任务",
      type: "Codex 原生任务",
      execution_source: "external/native",
      fingerprint: "runtime:native-task",
      status: "COMPLETED",
      cwd: "C:\\Bridge",
      thread_id: "native-thread",
      turn_id: "native-turn",
      active: false,
    });
    const service = new TaskService(scheduler);
    const result = await service.continueTask(task.id, "继续原生线程");
    assert.equal(result.accepted, false);
    assert.equal(result.status, "RECOVERY_REQUIRED");
    assert.equal(result.reason, "external/native task continuation requires an explicit thread_id");
    assert.equal(result.task.thread_id, "native-thread");
    scheduler.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("TaskService cancellation is scoped to AGENTS and reports the request phase", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-agents-cancel-service-"));
  try {
    const manager = new TaskManager(join(directory, "tasks.json"));
    const task = manager.create({
      name: "AGENTS cancel service",
      type: "ephemeral-codex",
      execution_source: "bridge",
      fingerprint: "agents-cancel-service",
      status: "RUNNING",
      cwd: "C:\\Bridge",
      active: true,
    });
    let requested = false;
    const scheduler = {
      store: manager,
      cancel(taskId: string) {
        assert.equal(taskId, task.id);
        requested = true;
        return true;
      },
      cancelRequested() {
        return requested;
      },
      taskInput() {
        return "只读取消测试";
      },
    } as any;
    const service = new TaskService(scheduler);
    const result = service.cancelTask(task.id);
    assert.equal(result.accepted, true);
    assert.equal(result.status, "cancel_requested");
    assert.equal(result.cancel_requested, true);
    assert.equal(service.taskInput(task.id), "只读取消测试");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("TaskService ends a recovery-required AGENTS task without a worker or process kill", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-agents-recovery-service-"));
  try {
    const manager = new TaskManager(join(directory, "tasks.json"));
    const task = manager.create({
      name: "需要处理的 AGENTS 任务",
      type: "ephemeral-codex",
      execution_source: "bridge",
      fingerprint: "agents-recovery-service",
      status: "RECOVERY_REQUIRED",
      progress: 60,
      stage: "reasoning",
      current_action: "正在分析",
      next_action: "等待结果",
      worker_id: null,
      cwd: "C:\\Bridge",
      last_error: "进程已退出",
      active: true,
    });
    const scheduler = {
      store: manager,
      cancel() {
        throw new Error("recovery end must not call scheduler.cancel");
      },
      cancelRequested() {
        return false;
      },
    } as any;
    const result = new TaskService(scheduler).cancelTask(task.id);
    assert.equal(result.accepted, true);
    assert.equal(result.status, "cancelled");
    assert.equal(result.task.status, "INTERRUPTED");
    assert.equal(result.task.progress, 0);
    assert.equal(result.task.worker_id, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
