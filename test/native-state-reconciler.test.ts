import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexAppServerAdapter } from "../src/app-server-adapter.js";
import { NativeStateReconciler } from "../src/native-state-reconciler.js";
import { RuntimeStore } from "../src/runtime.js";
import { TaskManager } from "../src/task-manager.js";

function temporaryManager(): { directory: string; manager: TaskManager } {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-native-reconcile-"));
  return { directory, manager: new TaskManager(join(directory, "tasks.json")) };
}

function fakeAdapter(
  responses: Map<string, Record<string, unknown>>,
  reads: { count: number } = { count: 0 },
): CodexAppServerAdapter {
  return {
    async threadRead(threadId: string) {
      reads.count += 1;
      return responses.get(threadId) ?? { thread: { id: threadId, turns: [] } };
    },
  } as unknown as CodexAppServerAdapter;
}

function createNativeTask(manager: TaskManager, status: "RUNNING" | "NEED_CONFIRM" | "RECOVERY_REQUIRED" | "WAITING", threadId: string, turnId: string) {
  return manager.create({
    name: "原生残留任务",
    fingerprint: "native-reconcile-" + threadId,
    execution_source: "external/native",
    status,
    progress: 60,
    thread_id: threadId,
    turn_id: turnId,
    cwd: "C:\\中文工作区",
    active: true,
  });
}

function createLegacyFingerprintNativeTask(manager: TaskManager, status: "NEED_CONFIRM" | "RECOVERY_REQUIRED", threadId: string, turnId: string) {
  return manager.create({
    name: "Codex 任务 00000001/00000002",
    fingerprint: `runtime:${threadId}:${turnId}`,
    execution_source: "external/native",
    status,
    progress: 90,
    cwd: "C:\\中文工作区",
    active: true,
  });
}

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("NEED_CONFIRM with empty pending and persistent interrupted becomes INTERRUPTED", async () => {
  const temporary = temporaryManager();
  const runtime = new RuntimeStore();
  try {
    const task = createNativeTask(temporary.manager, "NEED_CONFIRM", "thread-interrupted", "turn-interrupted");
    const reconciler = new NativeStateReconciler(
      temporary.manager,
      fakeAdapter(new Map([["thread-interrupted", { thread: { id: "thread-interrupted", turns: [{ id: "turn-interrupted", status: "interrupted" }], pending_requests: [] } }]])),
      runtime,
    );
    const summary = await reconciler.reconcile();
    assert.equal(temporary.manager.get(task.id).status, "INTERRUPTED");
    assert.equal(temporary.manager.get(task.id).completed_at !== null, true);
    assert.equal(summary.corrected, 1);
    reconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("RECOVERY_REQUIRED with persistent completed becomes COMPLETED", async () => {
  const temporary = temporaryManager();
  try {
    const task = createNativeTask(temporary.manager, "RECOVERY_REQUIRED", "thread-completed", "turn-completed");
    const reconciler = new NativeStateReconciler(
      temporary.manager,
      fakeAdapter(new Map([["thread-completed", { thread: { id: "thread-completed", turns: [{ id: "turn-completed", status: "completed" }] } }]])),
      new RuntimeStore(),
    );
    await reconciler.reconcile();
    const corrected = temporary.manager.get(task.id);
    assert.equal(corrected.status, "COMPLETED");
    assert.equal(corrected.progress, 100);
    assert.equal(corrected.last_error, null);
    reconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("RUNNING with persistent failed becomes FAILED", async () => {
  const temporary = temporaryManager();
  try {
    const task = createNativeTask(temporary.manager, "RUNNING", "thread-failed", "turn-failed");
    const reconciler = new NativeStateReconciler(
      temporary.manager,
      fakeAdapter(new Map([["thread-failed", { thread: { id: "thread-failed", turns: [{ id: "turn-failed", status: "failed" }] } }]])),
      new RuntimeStore(),
    );
    await reconciler.reconcile();
    assert.equal(temporary.manager.get(task.id).status, "FAILED");
    reconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("live active turn wins over stale persistent terminal history", async () => {
  const temporary = temporaryManager();
  const runtime = new RuntimeStore();
  try {
    const task = createNativeTask(temporary.manager, "RUNNING", "thread-live", "turn-live");
    runtime.markTurnAccepted("thread-live", "turn-live");
    const reconciler = new NativeStateReconciler(
      temporary.manager,
      fakeAdapter(new Map([["thread-live", { thread: { id: "thread-live", turns: [{ id: "turn-live", status: "completed" }] } }]])),
      runtime,
    );
    const summary = await reconciler.reconcile();
    assert.equal(temporary.manager.get(task.id).status, "RUNNING");
    assert.equal(summary.kept_live, 1);
    reconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("real pending request keeps NEED_CONFIRM and runtime-unavailable without terminal evidence stays unchanged", async () => {
  const temporary = temporaryManager();
  try {
    const pendingRuntime = new RuntimeStore();
    const pendingTask = createNativeTask(temporary.manager, "RUNNING", "thread-pending", "turn-pending");
    pendingRuntime.markTurnAccepted("thread-pending", "turn-pending");
    assert.equal(pendingRuntime.recordServerRequest(7, "item/commandExecution/requestApproval", { threadId: "thread-pending", turnId: "turn-pending" }), "recorded");
    const pendingReconciler = new NativeStateReconciler(
      temporary.manager,
      fakeAdapter(new Map([["thread-pending", { thread: { id: "thread-pending", turns: [{ id: "turn-pending", status: "completed" }] } }]])),
      pendingRuntime,
    );
    await pendingReconciler.reconcile();
    assert.equal(temporary.manager.get(pendingTask.id).status, "NEED_CONFIRM");
    pendingReconciler.close();

    const unknownTask = createNativeTask(temporary.manager, "RECOVERY_REQUIRED", "thread-unknown", "turn-unknown");
    const reads = { count: 0 };
    const unknownReconciler = new NativeStateReconciler(
      temporary.manager,
      fakeAdapter(new Map([["thread-unknown", { thread: { id: "thread-unknown", turns: [{ id: "turn-unknown", status: "inProgress" }] } }]]), reads),
      new RuntimeStore(),
    );
    const summary = await unknownReconciler.reconcile();
    assert.equal(temporary.manager.get(unknownTask.id).status, "RECOVERY_REQUIRED");
    assert.ok(summary.no_terminal_evidence >= 1);
    assert.equal(reads.count, 2);
    unknownReconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("persistent pending_requests also prevents terminal cleanup when runtime is unavailable", async () => {
  const temporary = temporaryManager();
  try {
    const task = createNativeTask(temporary.manager, "NEED_CONFIRM", "thread-persistent-pending", "turn-persistent-pending");
    const reconciler = new NativeStateReconciler(
      temporary.manager,
      fakeAdapter(new Map([["thread-persistent-pending", { thread: { id: "thread-persistent-pending", turns: [{ id: "turn-persistent-pending", status: "completed" }], pending_requests: [{}] } }]])),
      new RuntimeStore(),
    );
    await reconciler.reconcile();
    assert.equal(temporary.manager.get(task.id).status, "NEED_CONFIRM");
    reconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("reconciliation is cached for dashboard reads and terminal tasks are not queried again", async () => {
  const temporary = temporaryManager();
  try {
    createNativeTask(temporary.manager, "WAITING", "thread-cache", "turn-cache");
    const reads = { count: 0 };
    const reconciler = new NativeStateReconciler(
      temporary.manager,
      fakeAdapter(new Map([["thread-cache", { thread: { id: "thread-cache", turns: [{ id: "turn-cache", status: "completed" }] } }]]), reads),
      new RuntimeStore(),
      { minIntervalMs: 60_000 },
    );
    await reconciler.ensureReconciled();
    await reconciler.ensureReconciled();
    assert.equal(reads.count, 1);
    assert.equal(temporary.manager.unfinished().length, 0);
    reconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("native terminal lifecycle triggers event-driven reconciliation", async () => {
  const temporary = temporaryManager();
  const runtime = new RuntimeStore();
  try {
    const task = createNativeTask(temporary.manager, "RUNNING", "thread-event", "turn-event");
    const reconciler = new NativeStateReconciler(
      temporary.manager,
      fakeAdapter(new Map([["thread-event", { thread: { id: "thread-event", turns: [{ id: "turn-event", status: "completed" }] } }]])),
      runtime,
    );
    runtime.recordNotification("turn/completed", { threadId: "thread-event", turn: { id: "turn-event", status: "completed" } });
    await wait();
    assert.equal(temporary.manager.get(task.id).status, "COMPLETED");
    reconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("legacy runtime fingerprint restores native mapping, clears stale confirmation, and persists readable title", async () => {
  const temporary = temporaryManager();
  try {
    const threadId = "00000001-0000-7000-8000-000000000001";
    const turnId = "00000002-0000-7000-8000-000000000002";
    const task = createLegacyFingerprintNativeTask(temporary.manager, "NEED_CONFIRM", threadId, turnId);
    const reconciler = new NativeStateReconciler(
      temporary.manager,
      { async threadRead() { return { thread: { id: threadId, name: null, preview: "请在当前仓库中实施一个受控的小版本修复：Local Codex Bridge V4.2.1｜Worker Binding Fix。", turns: [{ id: turnId, status: "interrupted" }], pending_requests: [] } }; } } as any,
      new RuntimeStore(),
    );
    const summary = await reconciler.reconcile();
    const corrected = temporary.manager.get(task.id);
    assert.equal(corrected.thread_id, threadId);
    assert.equal(corrected.turn_id, turnId);
    assert.equal(corrected.status, "INTERRUPTED");
    assert.equal(corrected.name, "Local Codex Bridge V4.2.1｜Worker Binding Fix");
    assert.equal(summary.mapping_recovered, 1);
    assert.equal(summary.title_updates, 1);
    assert.equal(new TaskManager(temporary.manager.filePath).get(task.id).name, "Local Codex Bridge V4.2.1｜Worker Binding Fix");
    reconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});
