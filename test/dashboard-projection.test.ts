import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildDashboardTaskProjection } from "../src/dashboard-projection.js";
import { TaskManager } from "../src/task-manager.js";

function temporaryManager(): { directory: string; manager: TaskManager } {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-dashboard-projection-"));
  return { directory, manager: new TaskManager(join(directory, "tasks.json")) };
}

test("dashboard projection uses one canonical snapshot and prioritizes confirmation", () => {
  const temporary = temporaryManager();
  try {
    const running = temporary.manager.create({
      name: "Bridge 执行任务",
      fingerprint: "dashboard-running",
      execution_source: "bridge",
      status: "RUNNING",
      progress: 65,
      thread_id: "thread-running",
      turn_id: "turn-running",
      worker_id: "luna-1",
      cwd: "C:\\Bridge",
    });
    const confirmation = temporary.manager.create({
      name: "需要确认的原生任务",
      fingerprint: "dashboard-confirm",
      execution_source: "external/native",
      status: "NEED_CONFIRM",
      progress: 40,
      thread_id: "thread-confirm",
      turn_id: "turn-confirm",
      cwd: "C:\\Bridge",
    });
    temporary.manager.create({
      name: "排队任务",
      fingerprint: "dashboard-waiting",
      execution_source: "bridge",
      status: "WAITING",
      cwd: "C:\\Bridge",
    });
    const completed = temporary.manager.create({
      name: "最近完成任务",
      fingerprint: "dashboard-completed",
      execution_source: "bridge",
      status: "COMPLETED",
      progress: 100,
      completed_at: "2026-08-26T01:00:00.000Z",
      cwd: "C:\\Bridge",
    });

    const projection = buildDashboardTaskProjection(temporary.manager.snapshot().tasks);

    assert.equal(projection.current?.id, confirmation.id);
    assert.equal(projection.current_kind, "active");
    assert.equal(projection.current?.name, projection.active.find((task) => task.id === confirmation.id)?.name);
    assert.deepEqual(
      new Set(projection.active.map((task) => task.id)),
      new Set([running.id, confirmation.id]),
    );
    assert.equal(projection.waiting.length, 1);
    assert.deepEqual(projection.pending_confirmations.map((task) => task.id), [confirmation.id]);
    assert.equal(projection.native_active_count, 1);
    assert.equal(projection.bridge_active_count, 1);
    assert.equal(projection.recent_completed[0]?.id, completed.id);
    assert.equal(projection.active.some((task) => task.status === "COMPLETED"), false);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("dashboard projection falls back to recent completion or idle", () => {
  const temporary = temporaryManager();
  try {
    const completed = temporary.manager.create({
      name: "已完成",
      fingerprint: "dashboard-only-completed",
      execution_source: "bridge",
      status: "DONE",
      progress: 100,
      cwd: "C:\\Bridge",
    });
    const recent = buildDashboardTaskProjection(temporary.manager.snapshot().tasks);
    assert.equal(recent.current?.id, completed.id);
    assert.equal(recent.current_kind, "recent_completed");
    assert.equal(recent.current?.name, recent.recent_completed[0]?.name);

    const empty = buildDashboardTaskProjection([]);
    assert.equal(empty.current, null);
    assert.equal(empty.current_kind, "idle");
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("external/native duplicate turns collapse by thread and turn without touching Bridge tasks", () => {
  const temporary = temporaryManager();
  try {
    temporary.manager.create({
      name: "原生重复捕获 1",
      fingerprint: "native-duplicate-1",
      execution_source: "external/native",
      status: "RUNNING",
      thread_id: "thread-same",
      turn_id: "turn-same",
      cwd: "C:\\Bridge",
    });
    temporary.manager.create({
      name: "原生重复捕获 2",
      fingerprint: "native-duplicate-2",
      execution_source: "external/native",
      status: "RUNNING",
      thread_id: "thread-same",
      turn_id: "turn-same",
      cwd: "C:\\Bridge",
    });

    const projection = buildDashboardTaskProjection(temporary.manager.snapshot().tasks);

    assert.equal(projection.active.length, 1);
    assert.equal(projection.native_active_count, 1);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("dashboard projection limits the default recent-completed view while preserving history", () => {
  const temporary = temporaryManager();
  try {
    for (let index = 0; index < 6; index += 1) {
      temporary.manager.create({
        name: "完成任务 " + index,
        fingerprint: "dashboard-history-" + index,
        execution_source: "bridge",
        status: "COMPLETED",
        progress: 100,
        cwd: "C:\\Bridge",
      });
    }
    const projection = buildDashboardTaskProjection(temporary.manager.snapshot().tasks);
    assert.equal(projection.recent_completed.length, 5);
    assert.equal(projection.history.length, 6);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("dashboard separates active, queued, attention, and terminal task states", () => {
  const temporary = temporaryManager();
  try {
    const definitions = [
      ["starting", "STARTING"],
      ["running", "RUNNING"],
      ["waiting-user", "NEED_CONFIRM"],
      ["queued", "WAITING"],
      ["retrying", "RETRYING"],
      ["recovery", "RECOVERY_REQUIRED"],
      ["paused", "PAUSED"],
      ["blocked", "BLOCKED"],
      ["interrupted", "INTERRUPTED"],
      ["failed", "FAILED"],
      ["completed", "COMPLETED"],
      ["done", "DONE"],
    ] as const;
    for (const [name, status] of definitions) {
      temporary.manager.create({
        name,
        fingerprint: "dashboard-state-" + name,
        execution_source: "bridge",
        status,
        progress: status === "COMPLETED" || status === "DONE" ? 100 : 60,
        cwd: "C:\\Bridge",
      });
    }
    const projection = buildDashboardTaskProjection(temporary.manager.snapshot().tasks);
    assert.deepEqual(
      new Set(projection.active.map((task) => task.status)),
      new Set(["STARTING", "RUNNING", "NEED_CONFIRM"]),
    );
    assert.deepEqual(
      new Set(projection.waiting.map((task) => task.status)),
      new Set(["WAITING", "RETRYING"]),
    );
    assert.deepEqual(
      new Set(projection.attention.map((task) => task.status)),
      new Set(["RECOVERY_REQUIRED", "PAUSED", "BLOCKED"]),
    );
    assert.equal(projection.history.length, 4);
    assert.equal(projection.active.some((task) => task.status === "RECOVERY_REQUIRED"), false);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("dashboard requires live context for active and waiting-user projections", () => {
  const temporary = temporaryManager();
  try {
    const running = temporary.manager.create({
      name: "真实运行任务",
      fingerprint: "dashboard-context-running",
      execution_source: "bridge",
      status: "RUNNING",
      progress: 60,
      cwd: "C:\\Bridge",
    });
    const staleRunning = temporary.manager.create({
      name: "失去上下文的运行任务",
      fingerprint: "dashboard-context-stale",
      execution_source: "bridge",
      status: "RUNNING",
      progress: 60,
      cwd: "C:\\Bridge",
    });
    const queued = temporary.manager.create({
      name: "真实排队任务",
      fingerprint: "dashboard-context-queued",
      execution_source: "bridge",
      status: "WAITING",
      cwd: "C:\\Bridge",
    });
    const waitingUser = temporary.manager.create({
      name: "有效待确认任务",
      fingerprint: "dashboard-context-user",
      execution_source: "external/native",
      status: "NEED_CONFIRM",
      thread_id: "thread-context",
      turn_id: "turn-context",
      cwd: "C:\\Bridge",
    });
    const projection = buildDashboardTaskProjection(temporary.manager.snapshot().tasks, {
      live_task_ids: new Set([running.id, waitingUser.id]),
      queued_task_ids: new Set([queued.id]),
      waiting_user_task_ids: new Set([waitingUser.id]),
    });

    assert.deepEqual(new Set(projection.active.map((task) => task.id)), new Set([running.id, waitingUser.id]));
    assert.deepEqual(projection.waiting.map((task) => task.id), [queued.id]);
    assert.equal(projection.active.some((task) => task.id === staleRunning.id), false);

    const noPending = buildDashboardTaskProjection(temporary.manager.snapshot().tasks, {
      live_task_ids: new Set([running.id]),
      queued_task_ids: new Set([queued.id]),
      waiting_user_task_ids: new Set(),
    });
    assert.equal(noPending.active.some((task) => task.id === waitingUser.id), false);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});
