import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ModelGuard } from "../src/model-guard.js";
import { RuntimeStore } from "../src/runtime.js";
import {
  ServiceSessionManager,
  ServiceSessionStore,
} from "../src/service-session.js";
import { Scheduler } from "../src/scheduler.js";
import { TaskManager } from "../src/task-manager.js";
import type { CodexAppServerAdapter } from "../src/app-server-adapter.js";
import type { AppServerManager } from "../src/app-server.js";
import { ControlSurface } from "../src/tools.js";

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, attempts = 30): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await wait();
  }
  assert.equal(condition(), true, "condition did not become true before timeout");
}

interface FakeState {
  threadStarts: Array<{ id: string; serviceName: string | null }>;
  threadResumes: string[];
  turnStatus: Map<string, string>;
  busyThread: string | null;
  turnCount: number;
}

function fakeAdapter(state: FakeState): CodexAppServerAdapter {
  let threadCount = 0;
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
    async threadStart(params: Record<string, unknown>) {
      threadCount += 1;
      const id = `service-thread-${threadCount}`;
      state.threadStarts.push({
        id,
        serviceName: typeof params.serviceName === "string" ? params.serviceName : null,
      });
      return {
        thread_id: id,
        model: "gpt-5.6-luna",
        model_provider: "official",
        reasoning_effort: "max",
        raw: { sandbox: { type: "readOnly" } },
      };
    },
    async threadResume(threadId: string) {
      state.threadResumes.push(threadId);
      if (state.busyThread === threadId) {
        throw new Error("thread/resume rejected: active writer busy");
      }
      return {
        thread_id: threadId,
        model: "gpt-5.6-luna",
        model_provider: "official",
        reasoning_effort: "max",
        raw: { sandbox: { type: "readOnly" } },
      };
    },
    async threadRead(threadId: string) {
      const turn = [...state.turnStatus.entries()]
        .find(([key]) => key.startsWith(`${threadId}:`));
      return {
        thread: {
          id: threadId,
          turns: turn ? [{ id: turn[0].slice(threadId.length + 1), status: turn[1] }] : [],
        },
      };
    },
    async turnStart(params: Record<string, unknown>) {
      state.turnCount += 1;
      const threadId = String(params.threadId);
      const turnId = `service-turn-${state.turnCount}`;
      state.turnStatus.set(`${threadId}:${turnId}`, "inProgress");
      return {
        turn_id: turnId,
        status: "inProgress",
        model: "gpt-5.6-luna",
        reasoning_effort: "max",
        raw: {},
      };
    },
    async turnInterrupt() { return {}; },
    health() {
      return {
        status: {} as never,
        model_catalog: "available" as const,
        last_model_catalog_at: null,
        last_error: null,
      };
    },
  } as unknown as CodexAppServerAdapter;
}

test("Bridge Agent durable service ownership survives reload without a transcript store", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-service-store-"));
  const filePath = join(directory, "service_sessions.json");
  try {
    const first = new ServiceSessionStore(filePath);
    const manager = new ServiceSessionManager(first, { maxTurns: 2, ownerProcessId: 101 });
    const plan = manager.planForTask("C:\\Bridge", "task-a");
    assert.equal(plan.mode, "start");
    manager.bindThread(plan, "service-thread-a", "task-a");
    manager.markTurnAccepted(plan.session_id, "task-a");
    manager.complete("task-a", true);

    const reloaded = new ServiceSessionStore(filePath);
    const persisted = reloaded.list();
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]?.owner, "bridge-agent");
    assert.equal(persisted[0]?.thread_id, "service-thread-a");
    assert.equal(persisted[0]?.turn_count, 1);
    assert.equal(persisted[0]?.checkpoint.last_completed_task_id, "task-a");
    const serialized = readFileSync(filePath, "utf8");
    assert.equal(serialized.includes("prompt"), false);
    assert.equal(serialized.includes("transcript"), false);
    assert.equal(serialized.includes("final_result"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Bridge Agent rotates a bounded service thread and keeps retired ownership explicit", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-service-rotation-"));
  const filePath = join(directory, "service_sessions.json");
  try {
    const store = new ServiceSessionStore(filePath);
    const manager = new ServiceSessionManager(store, { maxTurns: 1 });
    const first = manager.planForTask("C:\\Bridge", "task-a");
    manager.bindThread(first, "service-thread-a", "task-a");
    manager.markTurnAccepted(first.session_id, "task-a");
    manager.complete("task-a", true);

    const second = manager.planForTask("C:\\Bridge", "task-b");
    assert.equal(second.mode, "start");
    assert.notEqual(second.session_id, first.session_id);
    const sessions = store.list();
    assert.equal(sessions.find((item) => item.session_id === first.session_id)?.status, "retired");
    assert.equal(sessions.find((item) => item.session_id === second.session_id)?.generation, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("default scheduler routing uses Bridge Agent service threads and rotates after an external writer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-service-scheduler-"));
  try {
    const taskManager = new TaskManager(join(directory, "tasks.json"));
    const serviceStore = new ServiceSessionStore(join(directory, "service_sessions.json"));
    const serviceSessions = new ServiceSessionManager(serviceStore, { maxTurns: 8 });
    const state: FakeState = {
      threadStarts: [],
      threadResumes: [],
      turnStatus: new Map(),
      busyThread: null,
      turnCount: 0,
    };
    const runtime = new RuntimeStore();
    const scheduler = new Scheduler(
      taskManager,
      fakeAdapter(state),
      new ModelGuard({ requireCatalog: true }),
      runtime,
      { serviceSessions },
    );

    const first = scheduler.submit({
      name: "Bridge Agent task",
      text: "run service task",
      cwd: "C:\\Bridge",
      fingerprint: "service-task-a",
      sandbox: "read-only",
      write_roots: [],
    });
    await waitFor(() => taskManager.get(first.task_id).turn_id !== null);
    const firstTask = taskManager.get(first.task_id);
    assert.equal(state.threadStarts[0]?.serviceName, "local-codex-bridge-service-codex");
    assert.equal(serviceStore.byThread(firstTask.thread_id!)?.owner, "bridge-agent");
    runtime.recordNotification("turn/completed", {
      threadId: firstTask.thread_id,
      turn: { id: firstTask.turn_id, status: "completed" },
    });
    await waitFor(() => taskManager.get(first.task_id).status === "COMPLETED");

    // A desktop/native writer on a different thread is not part of the service mapping.
    const externalThread = "desktop-native-thread";
    assert.equal(serviceStore.byThread(externalThread), null);
    state.busyThread = firstTask.thread_id;
    const second = scheduler.submit({
      name: "Bridge Agent rotation",
      text: "continue service task",
      cwd: "C:\\Bridge",
      fingerprint: "service-task-b",
      sandbox: "read-only",
      write_roots: [],
    });
    await waitFor(() => taskManager.get(second.task_id).turn_id !== null);
    const secondTask = taskManager.get(second.task_id);
    assert.equal(secondTask.thread_id, "service-thread-2");
    assert.equal(state.threadResumes.includes(firstTask.thread_id!), true);
    assert.equal(state.threadStarts[1]?.serviceName, "local-codex-bridge-service-codex");
    assert.equal(serviceStore.byThread(firstTask.thread_id!)?.status, "retired");
    assert.equal(serviceStore.byThread(secondTask.thread_id!)?.owner, "bridge-agent");
    scheduler.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("explicit external same-thread busy remains busy and never auto-rotates", async () => {
  const requests: string[] = [];
  const appServer = {
    runtime: new RuntimeStore(),
    status() {
      return {
        bridge_pid: 1,
        app_server_pid: 2,
        process_state: "running",
        transport: "stdio",
        endpoint: "stdio://",
        attachable: false,
        desktop_ui_visibility: "not_attached",
        error: null,
      };
    },
    async request(method: string) {
      requests.push(method);
      if (method === "thread/resume") {
        throw new Error("thread/resume rejected: active writer busy");
      }
      throw new Error(`unexpected method ${method}`);
    },
  } as unknown as AppServerManager;
  const surface = new ControlSurface(appServer);
  const result = await surface.call("codex_turn", {
    text: "do not attach to the desktop thread",
    thread_id: "desktop-native-thread",
  }) as Record<string, unknown>;
  assert.equal(result.status, "busy");
  assert.deepEqual(requests, ["thread/resume"]);
});
