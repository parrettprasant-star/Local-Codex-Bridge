import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexAppServerAdapter } from "../src/app-server-adapter.js";
import { ModelGuard } from "../src/model-guard.js";
import { RuntimeStore } from "../src/runtime.js";
import { Scheduler } from "../src/scheduler.js";
import { TaskManager } from "../src/task-manager.js";

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeAdapter(state: { turnStarts: number; turnStatus: Map<string, string> }): CodexAppServerAdapter {
  let threadCount = 0;
  let turnCount = 0;
  return {
    async initialize() {},
    async modelList() {
      return [{
        id: "runtime-luna-id",
        model: "runtime-luna-id",
        displayName: "GPT Luna",
        supportedReasoningEfforts: ["max"],
        defaultReasoningEffort: "max",
        hidden: false,
        isDefault: true,
      }];
    },
    async threadStart() {
      threadCount += 1;
      return {
        thread_id: `thread-${threadCount}`,
        model: "runtime-luna-id",
        model_provider: "official",
        reasoning_effort: "max",
        raw: { sandbox: { type: "readOnly" } },
      };
    },
    async threadResume(threadId: string) {
      return {
        thread_id: threadId,
        model: "runtime-luna-id",
        model_provider: "official",
        reasoning_effort: "max",
        raw: { sandbox: { type: "readOnly" } },
      };
    },
    async threadRead(threadId: string) {
      const turnId = [...state.turnStatus.keys()].find((id) => id.startsWith(threadId + ":"))?.split(":")[1];
      return { thread: { id: threadId, turns: turnId ? [{ id: turnId, status: state.turnStatus.get(threadId + ":" + turnId) }] : [] } };
    },
    async turnStart(params: Record<string, unknown>) {
      state.turnStarts += 1;
      turnCount += 1;
      const threadId = String(params.threadId);
      const turnId = `turn-${turnCount}`;
      state.turnStatus.set(threadId + ":" + turnId, "inProgress");
      return { turn_id: turnId, status: "inProgress", model: "runtime-luna-id", reasoning_effort: "max", raw: {} };
    },
    async turnInterrupt() { return {}; },
    health() { return { status: {} as never, model_catalog: "available", last_model_catalog_at: null, last_error: null }; },
  } as unknown as CodexAppServerAdapter;
}

function temporaryManager(): { directory: string; manager: TaskManager } {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-scheduler-"));
  return { directory, manager: new TaskManager(join(directory, "tasks.json")) };
}

test("Bridge scheduler binds durable worker/thread/turn mappings from 1 through 5 and releases them", async () => {
  const temporary = temporaryManager();
  try {
    const state = { turnStarts: 0, turnStatus: new Map<string, string>() };
    const runtime = new RuntimeStore();
    const scheduler = new Scheduler(
      temporary.manager,
      fakeAdapter(state),
      new ModelGuard({ requireCatalog: true }),
      runtime,
    );
    for (const count of [1, 2, 3, 5]) {
      const submitted = Array.from({ length: count }, (_, index) => scheduler.submit({
        name: `binding-${count}-${index + 1}`,
        text: `binding ${count}-${index + 1}`,
        cwd: "C:\\Bridge",
        fingerprint: `binding-${count}-${index + 1}`,
        sandbox: "read-only",
        write_roots: [],
      }));
      await wait(60);
      assert.equal(scheduler.snapshot().running_workers, count);
      const records = submitted.map((item) => temporary.manager.get(item.task_id));
      assert.ok(records.every((task) => task.execution_source === "bridge"));
      assert.ok(records.every((task) => task.worker_id && task.thread_id && task.turn_id));
      assert.equal(new Set(records.map((task) => task.worker_id)).size, count);
      assert.equal(new Set(records.map((task) => task.thread_id)).size, count);
      assert.equal(new Set(records.map((task) => task.turn_id)).size, count);

      for (const task of records) {
        runtime.recordNotification("turn/completed", {
          threadId: task.thread_id,
          turn: { id: task.turn_id, status: "completed" },
        });
      }
      await wait(60);
      assert.equal(scheduler.snapshot().running_workers, 0);
      assert.ok(submitted.every((item) => temporary.manager.get(item.task_id).worker_id === null));
    }
    scheduler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("scheduler releases workers for failed and interrupted native turns", async () => {
  const temporary = temporaryManager();
  try {
    const state = { turnStarts: 0, turnStatus: new Map<string, string>() };
    const runtime = new RuntimeStore();
    const scheduler = new Scheduler(
      temporary.manager,
      fakeAdapter(state),
      new ModelGuard({ requireCatalog: true }),
      runtime,
    );
    const failed = scheduler.submit({ name: "failed", text: "failed", cwd: "C:\\Bridge", fingerprint: "failed", sandbox: "read-only", write_roots: [] });
    await wait(50);
    const failedTask = temporary.manager.get(failed.task_id);
    runtime.recordNotification("turn/completed", {
      threadId: failedTask.thread_id,
      turn: { id: failedTask.turn_id, status: "failed" },
    });
    await wait(40);
    assert.equal(temporary.manager.get(failed.task_id).status, "FAILED");
    assert.equal(scheduler.snapshot().running_workers, 0);

    const interrupted = scheduler.submit({ name: "interrupted", text: "interrupted", cwd: "C:\\Bridge", fingerprint: "interrupted", sandbox: "read-only", write_roots: [] });
    await wait(50);
    const interruptedTask = temporary.manager.get(interrupted.task_id);
    runtime.recordNotification("turn/completed", {
      threadId: interruptedTask.thread_id,
      turn: { id: interruptedTask.turn_id, status: "interrupted" },
    });
    await wait(40);
    assert.equal(temporary.manager.get(interrupted.task_id).status, "INTERRUPTED");
    assert.equal(temporary.manager.get(interrupted.task_id).worker_id, null);
    assert.equal(scheduler.snapshot().running_workers, 0);
    scheduler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("scheduler caps six submissions at five running workers and starts the sixth after release", async () => {
  const temporary = temporaryManager();
  try {
    const state = { turnStarts: 0, turnStatus: new Map<string, string>() };
    const runtime = new RuntimeStore();
    const adapter = fakeAdapter(state);
    const guard = new ModelGuard({ requireCatalog: true });
    const scheduler = new Scheduler(temporary.manager, adapter, guard, runtime);
    const submitted = Array.from({ length: 6 }, (_, index) => scheduler.submit({
      name: `task-${index + 1}`,
      text: `safe task ${index + 1}`,
      cwd: "C:\\Bridge",
      fingerprint: `fingerprint-${index + 1}`,
      sandbox: "read-only",
      write_roots: [],
    }));
    await wait(40);
    assert.equal(scheduler.snapshot().running_workers, 5);
    assert.equal(scheduler.snapshot().queue_depth, 1);
    assert.equal(state.turnStarts, 5);
    const active = scheduler.snapshot().active;
    assert.equal(new Set(active.map((item) => item.workerId)).size, 5);
    assert.equal(new Set(active.map((item) => item.threadId)).size, 5);
    assert.equal(new Set(active.map((item) => item.turnId)).size, 5);

    const first = temporary.manager.get(submitted[0]!.task_id);
    assert.equal(first.execution_source, "bridge");
    assert.ok(first.worker_id && first.thread_id && first.turn_id);
    runtime.recordNotification("turn/completed", {
      threadId: first.thread_id,
      turn: { id: first.turn_id, status: "completed" },
    });
    await wait(40);
    assert.equal(scheduler.snapshot().running_workers, 5);
    assert.equal(scheduler.snapshot().queue_depth, 0);
    assert.equal(state.turnStarts, 6);
    scheduler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("duplicate fingerprint returns the durable task without another turn", async () => {
  const temporary = temporaryManager();
  try {
    const state = { turnStarts: 0, turnStatus: new Map<string, string>() };
    const scheduler = new Scheduler(
      temporary.manager,
      fakeAdapter(state),
      new ModelGuard({ requireCatalog: true }),
      new RuntimeStore(),
    );
    const input = { name: "same", text: "same", cwd: "C:\\Bridge", fingerprint: "stable-key", sandbox: "read-only" as const, write_roots: [] };
    const first = scheduler.submit(input);
    const second = scheduler.submit(input);
    assert.equal(first.task_id, second.task_id);
    assert.equal(second.deduplicated, true);
    await wait(30);
    assert.equal(state.turnStarts, 1);
    scheduler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("twenty mock tasks never exceed the five-worker ceiling", async () => {
  const temporary = temporaryManager();
  try {
    const state = { turnStarts: 0, turnStatus: new Map<string, string>() };
    const scheduler = new Scheduler(
      temporary.manager,
      fakeAdapter(state),
      new ModelGuard({ requireCatalog: true }),
      new RuntimeStore(),
    );
    for (let index = 0; index < 20; index += 1) {
      scheduler.submit({
        name: `bulk-${index}`,
        text: `bulk ${index}`,
        cwd: "C:\\Bridge",
        fingerprint: `bulk-${index}`,
        sandbox: "read-only",
        write_roots: [],
      });
    }
    await wait(60);
    assert.ok(scheduler.snapshot().running_workers <= 5);
    assert.equal(scheduler.snapshot().queue_depth, 15);
    scheduler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("restart reconciliation never starts a new turn and recovers authoritative states", async () => {
  const temporary = temporaryManager();
  try {
    const running = temporary.manager.create({
      name: "running",
      fingerprint: "running-key",
      status: "RUNNING",
      thread_id: "thread-running",
      turn_id: "turn-running",
      cwd: "C:\\Bridge",
      active: true,
    });
    const completed = temporary.manager.create({
      name: "completed",
      fingerprint: "completed-key",
      status: "RUNNING",
      thread_id: "thread-completed",
      turn_id: "turn-completed",
      cwd: "C:\\Bridge",
      active: false,
    });
    const state = {
      turnStarts: 0,
      turnStatus: new Map([
        ["thread-running:turn-running", "inProgress"],
        ["thread-completed:turn-completed", "completed"],
      ]),
    };
    const scheduler = new Scheduler(
      temporary.manager,
      fakeAdapter(state),
      new ModelGuard({ requireCatalog: true }),
      new RuntimeStore(),
    );
    await scheduler.reconcile();
    assert.equal(temporary.manager.get(running.id).status, "RUNNING");
    assert.equal(temporary.manager.get(completed.id).status, "COMPLETED");
    assert.equal(state.turnStarts, 0);
    scheduler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("continuation resumes the owned thread and starts a new turn", async () => {
  const temporary = temporaryManager();
  try {
    const state = { turnStarts: 0, turnStatus: new Map<string, string>() };
    const runtime = new RuntimeStore();
    const scheduler = new Scheduler(
      temporary.manager,
      fakeAdapter(state),
      new ModelGuard({ requireCatalog: true }),
      runtime,
    );
    const first = scheduler.submit({
      name: "川西住宿素材整理",
      title: "川西住宿素材整理",
      text: "整理住宿素材",
      cwd: "C:\\Bridge",
      fingerprint: "session-key",
      sandbox: "read-only",
      write_roots: [],
    });
    await wait(40);
    const running = temporary.manager.get(first.task_id);
    runtime.recordNotification("turn/completed", {
      threadId: running.thread_id,
      turn: { id: running.turn_id, status: "completed" },
    });
    state.turnStatus.set(running.thread_id! + ":" + running.turn_id!, "completed");
    await wait(20);
    assert.equal(temporary.manager.get(first.task_id).result_manifest.review_status, "READY");
    assert.equal(temporary.manager.get(first.task_id).result_manifest.worker_id, "luna-1");
    const resumed = await scheduler.continueTask(first.task_id, {
      name: "川西住宿素材整理",
      title: "川西住宿素材整理",
      text: "继续核对输出",
      cwd: "C:\\Bridge",
      fingerprint: "session-key",
      existing_thread_id: running.thread_id!,
      sandbox: "read-only",
      write_roots: [],
    });
    assert.equal(resumed.accepted, true);
    const duplicateContinue = await scheduler.continueTask(first.task_id, {
      name: "川西住宿素材整理",
      title: "川西住宿素材整理",
      text: "重复继续不得开新线程",
      cwd: "C:\\Bridge",
      fingerprint: "session-key",
      existing_thread_id: running.thread_id!,
      sandbox: "read-only",
      write_roots: [],
    });
    assert.equal(duplicateContinue.accepted, false);
    assert.equal(duplicateContinue.status, "busy");
    await wait(40);
    const continued = temporary.manager.get(first.task_id);
    assert.equal(continued.result_manifest.review_status, "NOT_READY");
    assert.equal(continued.name, "川西住宿素材整理");
    assert.equal(continued.thread_id, running.thread_id);
    assert.equal(state.turnStarts, 2);
    scheduler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});
