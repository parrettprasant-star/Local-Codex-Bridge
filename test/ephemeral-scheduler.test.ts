import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import type { CodexAppServerAdapter } from "../src/app-server-adapter.js";
import {
  EphemeralTaskScheduler,
} from "../src/ephemeral-scheduler.js";
import {
  EphemeralCodexRunner,
  type CodexCapabilitySnapshot,
  type EphemeralCodexResult,
  type EphemeralCodexRunRequest,
} from "../src/ephemeral-codex-runner.js";
import { ModelGuard } from "../src/model-guard.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskRuntime } from "../src/task-runtime.js";

function wait(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, attempts = 100): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (condition()) return;
    await wait();
  }
  assert.equal(condition(), true, "condition did not become true before timeout");
}

function result(status: EphemeralCodexResult["status"], finalAnswer: string): EphemeralCodexResult {
  const now = new Date().toISOString();
  return {
    status,
    final_answer: finalAnswer,
    exit_code: status === "completed" ? 0 : null,
    signal: status === "interrupted" ? "SIGTERM" : null,
    stderr: status === "failed" ? "fake failure" : "",
    events: [],
    timings: {
      started_at: now,
      first_event_at: now,
      first_answer_at: now,
      completed_at: now,
      startup_ms: 1,
      time_to_first_event_ms: 1,
      time_to_first_answer_ms: 2,
      total_ms: 3,
      phase_timings: {
        submitted_at: now,
        task_created_at: now,
        queue_entered_at: now,
        worker_acquired_at: now,
        dispatch_at: now,
        prepare_spawn_at: now,
        process_spawn_called_at: now,
        process_created_at: now,
        streams_ready_at: now,
        first_json_at: now,
        first_session_at: now,
        first_content_at: now,
        final_response_at: now,
        queue_wait_ms: 1,
        worker_dispatch_ms: 1,
        process_spawn_ms: 1,
        codex_bootstrap_ms: 1,
        first_json_ms: 1,
        first_content_ms: 2,
        total_ms: 3,
      },
    },
    subagents: {
      support: "native",
      reported: false,
      active: 0,
      max_concurrent: 5,
      started: 0,
      stopped: 0,
    },
  };
}

const fakeCapabilities: CodexCapabilitySnapshot = {
  executable: "fake-codex",
  version: "0.148.0",
  detected_at: "2026-08-27T00:00:00.000Z",
  supports_ephemeral_exec: true,
  supports_json_events: true,
  supports_exec_sandbox: true,
  supports_exec_approval_policy: true,
  supports_exec_cwd: true,
  supports_multi_agent_feature: true,
  multi_agent_feature_state: "enabled",
  multi_agent_v2_state: "disabled",
  subagent_config: {
    max_concurrent_threads_per_session: true,
    max_depth: true,
    default_subagent_model: true,
    default_subagent_reasoning_effort: true,
    job_max_runtime_seconds: true,
  },
  native_subagents: "available",
  warnings: [],
};

class FakeRunner extends EphemeralCodexRunner {
  readonly calls: EphemeralCodexRunRequest[] = [];
  readonly pending: Array<{ resolve: (value: EphemeralCodexResult) => void }> = [];

  constructor() {
    super({ executable: "fake-codex" });
  }

  override capabilities(): CodexCapabilitySnapshot {
    return fakeCapabilities;
  }

  override async detectCapabilities(): Promise<CodexCapabilitySnapshot> {
    return fakeCapabilities;
  }

  override async run(request: EphemeralCodexRunRequest): Promise<EphemeralCodexResult> {
    this.calls.push(request);
    return await new Promise<EphemeralCodexResult>((resolve) => {
      const pending = { resolve };
      this.pending.push(pending);
      request.signal?.addEventListener("abort", () => resolve(result("interrupted", "")), { once: true });
    });
  }

  completeNext(value = result("completed", "EPHEMERAL FINAL")): void {
    const pending = this.pending.shift();
    pending?.resolve(value);
  }
}

function fakeAdapter(): CodexAppServerAdapter {
  return {
    async initialize() {},
    async modelList() {
      return [{
        id: "gpt-5.6-luna",
        model: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        supportedReasoningEfforts: ["max"],
        defaultReasoningEffort: "max",
        hidden: false,
        isDefault: true,
      }];
    },
    health() {
      return { status: {} as never, model_catalog: "available", last_model_catalog_at: null, last_error: null };
    },
  } as unknown as CodexAppServerAdapter;
}

test("ephemeral scheduler caps Bridge jobs at five and never persists thread or turn ids", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-ephemeral-scheduler-"));
  try {
    const manager = new TaskManager(join(directory, "tasks.json"));
    const runner = new FakeRunner();
    const scheduler = new EphemeralTaskScheduler(manager, fakeAdapter(), new ModelGuard({ requireCatalog: true }), new TaskRuntime(manager), runner);
    const submitted = Array.from({ length: 6 }, (_, index) => scheduler.submit({
      name: `ephemeral-${index + 1}`,
      text: `read only ${index + 1}`,
      cwd: "C:\\Bridge",
      fingerprint: `ephemeral-${index + 1}`,
      sandbox: "read-only",
      write_roots: [],
    }));
    await waitFor(() => runner.calls.length === 5);
    assert.equal(scheduler.snapshot().running_workers, 5);
    assert.equal(scheduler.snapshot().queue_depth, 1);
    for (const item of submitted.slice(0, 5)) {
      const task = manager.get(item.task_id);
      assert.equal(task.execution_source, "bridge");
      assert.equal(task.thread_id, null);
      assert.equal(task.turn_id, null);
    }
    runner.completeNext();
    await waitFor(() => runner.calls.length === 6);
    await waitFor(() => scheduler.snapshot().running_workers === 5);
    const first = manager.get(submitted[0]!.task_id);
    assert.equal(first.status, "COMPLETED");
    assert.equal(first.final_answer, "EPHEMERAL FINAL");
    assert.equal(first.thread_id, null);
    assert.equal(first.turn_id, null);
    assert.equal(scheduler.timingHistory()[0]?.task_id, submitted[0]!.task_id);
    assert.equal(scheduler.timingHistory()[0]?.queue_wait_ms, 1);
    scheduler.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("active ephemeral job cancellation aborts the exact child and cleans the slot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-ephemeral-cancel-"));
  try {
    const manager = new TaskManager(join(directory, "tasks.json"));
    const runner = new FakeRunner();
    const scheduler = new EphemeralTaskScheduler(manager, fakeAdapter(), new ModelGuard({ requireCatalog: true }), new TaskRuntime(manager), runner);
    const submitted = scheduler.submit({
      name: "cancel me",
      text: "read only cancellation probe",
      cwd: "C:\\Bridge",
      fingerprint: "cancel-me",
      sandbox: "read-only",
      write_roots: [],
    });
    await waitFor(() => runner.calls.length === 1);
    assert.equal(scheduler.cancel(submitted.task_id), true);
    assert.equal(scheduler.cancelRequested(submitted.task_id), true);
    await waitFor(() => manager.get(submitted.task_id).status === "INTERRUPTED");
    assert.equal(scheduler.cancelRequested(submitted.task_id), false);
    assert.equal(manager.get(submitted.task_id).last_error, "任务已取消");
    assert.equal(scheduler.snapshot().running_workers, 0);
    assert.equal(manager.get(submitted.task_id).thread_id, null);
    assert.equal(manager.get(submitted.task_id).turn_id, null);
    scheduler.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ephemeral process loss converges recovery-required tasks to interrupted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-ephemeral-recovery-"));
  let scheduler: EphemeralTaskScheduler | undefined;
  try {
    const manager = new TaskManager(join(directory, "tasks.json"));
    const lost = manager.create({
      name: "丢失的 AGENTS 任务",
      type: "ephemeral-codex",
      execution_source: "bridge",
      fingerprint: "ephemeral-process-loss",
      status: "RUNNING",
      progress: 60,
      stage: "reasoning",
      current_action: "正在分析",
      next_action: "等待结果",
      worker_id: "luna-1",
      cwd: "C:\\Bridge",
      active: true,
    });
    scheduler = new EphemeralTaskScheduler(
      manager,
      fakeAdapter(),
      new ModelGuard({ requireCatalog: true }),
      new TaskRuntime(manager),
      new FakeRunner(),
    );

    await scheduler.reconcile();
    const recovery = manager.get(lost.id);
    assert.equal(recovery.status, "RECOVERY_REQUIRED");
    assert.equal(recovery.progress, 0);
    assert.equal(recovery.stage, "需要处理");
    assert.equal(recovery.worker_id, null);
    assert.equal(scheduler.snapshot().running_workers, 0);
    assert.equal(scheduler.snapshot().queue_depth, 0);

    await scheduler.reconcile();
    const interrupted = manager.get(lost.id);
    assert.equal(interrupted.status, "INTERRUPTED");
    assert.equal(interrupted.progress, 0);
    assert.equal(interrupted.stage, "已中断");
    assert.equal(interrupted.worker_id, null);
  } finally {
    scheduler?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
