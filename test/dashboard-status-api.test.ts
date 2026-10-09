import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { McpHealthState } from "../src/mcp-health.js";
import { ModelGuard } from "../src/model-guard.js";
import { NativeStateReconciler } from "../src/native-state-reconciler.js";
import { RuntimeStore } from "../src/runtime.js";
import { TaskStatusServer, authorizedLocalFetch } from "./browser-safe-status-server.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskRuntime } from "../src/task-runtime.js";
import { TaskStatusStore } from "../src/task-status.js";

function liveTunnelHealth() {
  return {
    status: "running" as const,
    registration: "ready" as const,
    active_tunnel_id: "tunnel_00000000000000000000000000000000",
    client_version: "test",
    last_registration_error: null,
    health_url: "http://127.0.0.1:2428",
    parent_pid: null,
    mcp_child_pid: null,
    parent_process_alive: null,
    mcp_child_alive: null,
    health_probe: "unknown" as const,
    transport_status: "unknown" as const,
    transport_last_error: null,
    restart_attempt: null,
    last_initialize_at: null,
    last_tools_list_at: null,
    last_disconnect_reason: null,
    state_updated_at: null,
  };
}

test("normalized status exposes one dashboard projection for current, active, waiting, and history", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-dashboard-api-"));
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const runtime = new TaskRuntime(manager);
  const confirmation = manager.create({
    name: "等待确认任务",
    fingerprint: "dashboard-api-confirm",
    execution_source: "external/native",
    status: "NEED_CONFIRM",
    progress: 45,
    thread_id: "thread-confirm",
    turn_id: "turn-confirm",
    cwd: "C:\\中文工作区",
    active: true,
  });
  const running = manager.create({
    name: "Bridge 执行任务",
    type: "内容生产",
    fingerprint: "dashboard-api-running",
    execution_source: "bridge",
    status: "RUNNING",
    progress: 20,
    stage: "reading",
    current_action: "正在读取项目规则",
    next_action: "开始生成内容",
    worker_id: "luna-1",
    thread_id: "thread-running",
    turn_id: "turn-running",
    cwd: "C:\\中文工作区",
    active: false,
  });
  const completed = manager.create({
    name: "已完成任务",
    fingerprint: "dashboard-api-completed",
    execution_source: "bridge",
    status: "COMPLETED",
    progress: 100,
    completed_at: "2026-09-01T09:30:00.000Z",
    result_summary: "结果已生成",
    output_files: ["C:\\Reports\\result.txt"],
    cwd: "C:\\中文工作区",
    active: false,
  });
  const recovery = manager.create({
    name: "需要处理的旧 AGENTS 任务",
    fingerprint: "dashboard-api-recovery",
    execution_source: "bridge",
    status: "RECOVERY_REQUIRED",
    progress: 60,
    stage: "reasoning",
    current_action: "正在分析",
    next_action: "结束任务或重新提交",
    last_error: "Ephemeral Bridge tasks are not resumable after process loss",
    cwd: "C:\\中文工作区",
    active: false,
  });
  const server = new TaskStatusServer(statusStore, manager, runtime, {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    workingDirectoryTrace: () => ({
      requested_cwd: '"C:\\Users\\测试用户\\Desktop\\Bridge Agent 网络测试"',
      normalized_cwd: "C:\\Users\\测试用户\\Desktop\\Bridge Agent 网络测试",
      validated_cwd: "C:\\Users\\测试用户\\Desktop\\Bridge Agent 网络测试",
      executor_cwd: "C:\\Users\\测试用户\\Desktop\\Bridge Agent 网络测试",
      win32_current_directory: "C:\\Users\\测试用户\\Desktop\\Bridge Agent 网络测试",
      reason: null,
    }),
  });
  try {
    const address = await server.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/status`);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    const packageVersion = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;
    assert.equal(body.bridge.version, packageVersion, "status must follow the installed package, not an obsolete release constant");
    assert.equal(body.tasks.current.id, confirmation.id);
    assert.equal(body.tasks.current_kind, "active");
    assert.deepEqual(new Set(body.tasks.active.map((task: Record<string, unknown>) => task.id)), new Set([confirmation.id, running.id]));
    assert.equal(body.tasks.active.some((task: Record<string, unknown>) => task.id === completed.id), false);
    assert.equal(body.tasks.active.some((task: Record<string, unknown>) => task.id === recovery.id), false);
    assert.equal(body.tasks.attention.some((task: Record<string, unknown>) => task.id === recovery.id), true);
    assert.equal(body.tasks.pending_confirmations.length, 1);
    assert.equal(body.dashboard.pending_confirmation_count, 1);
    const currentProgress = body.tasks.current.progress_view as Record<string, unknown>;
    const runningProgress = body.tasks.active.find((task: Record<string, unknown>) => task.id === running.id).progress_view as Record<string, unknown>;
    const completedProgress = body.tasks.items.find((task: Record<string, unknown>) => task.id === completed.id).progress_view as Record<string, unknown>;
    const recoveryProgress = body.tasks.attention.find((task: Record<string, unknown>) => task.id === recovery.id).progress_view as Record<string, unknown>;
    assert.equal(currentProgress.phase_label, "等待确认");
    assert.equal(runningProgress.phase_label, "读取文件");
    assert.equal(runningProgress.category_label, "内容生产");
    assert.equal(runningProgress.progress, 20);
    assert.equal(completedProgress.phase_label, "已完成");
    assert.equal(completedProgress.result_summary, "结果已生成");
    assert.deepEqual(completedProgress.output_locations, ["C:\\Reports\\result.txt"]);
    assert.equal(recoveryProgress.phase_label, "需要处理");
    assert.equal(recoveryProgress.progress, null);
    assert.equal(body.workers.running, 0);
    assert.equal(body.workers.native_active, 1);
    assert.equal(body.activities.observe_requests, 0);
    assert.equal(body.plugin_bridge.status, "not_ready");
    assert.equal(body.native_session_transport.status, "disconnected");
    assert.equal(body.tunnel.status, "not_configured");
    assert.equal(body.tunnel.registration, "not_registered");
    assert.equal(body.tunnel.active_tunnel_id, null);
    assert.equal(body.control_center.source, "normalized_status");
    assert.equal(body.control_center.tunnel.state, "not_configured");
    assert.equal(body.control_center.tunnel.registration, "not_configured");
    assert.equal(body.control_center.codex.state, "waiting");
    assert.equal(body.build.label, `Local Codex Bridge ${packageVersion} development`);
    assert.equal(typeof body.build.loaded_asset_sha256, "string");
    assert.equal(body.working_directory.normalized_cwd, "C:\\Users\\测试用户\\Desktop\\Bridge Agent 网络测试");
    assert.equal(body.working_directory.executor_cwd, body.working_directory.win32_current_directory);
    assert.equal(body.working_directory.reason, null);
    assert.deepEqual(body.ephemeral_timings, []);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("normalized status reconciles stale external/native state before projection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-dashboard-native-api-"));
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const runtime = new RuntimeStore();
  const stale = manager.create({
    name: "旧待确认任务",
    fingerprint: "dashboard-api-stale-native",
    execution_source: "external/native",
    status: "NEED_CONFIRM",
    thread_id: "thread-stale",
    turn_id: "turn-stale",
    cwd: "C:\\中文工作区",
    active: true,
  });
  const adapter = {
    async threadRead() {
      return { thread: { id: "thread-stale", turns: [{ id: "turn-stale", status: "interrupted" }], pending_requests: [] } };
    },
  } as any;
  const reconciler = new NativeStateReconciler(manager, adapter, runtime);
  const server = new TaskStatusServer(statusStore, manager, new TaskRuntime(manager), {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    nativeStateReconciler: reconciler,
  });
  try {
    const address = await server.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/status`);
    const body = await response.json() as Record<string, any>;
    assert.equal(manager.get(stale.id).status, "INTERRUPTED");
    assert.equal(body.dashboard.pending_confirmation_count, 0);
    assert.equal(body.workers.native_active, 0);
    assert.equal(body.tasks.active.some((task: Record<string, unknown>) => task.id === stale.id), false);
  } finally {
    await server.close();
    reconciler.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("normalized status includes live Native turns owned by the V6 plugin child and clears terminal turns", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-dashboard-plugin-native-"));
  const tunnelRoot = join(directory, "tunnel-bridge");
  const runRoot = join(directory, "run");
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(join(runRoot, "tunnel-state.json"), JSON.stringify({
    status: "running",
    registration: "ready",
    process_id: process.pid,
  }), "utf8");
  writeFileSync(join(runRoot, "tunnel-client.pid"), String(process.pid), "utf8");
  writeFileSync(join(runRoot, "desktop-ownership.json"), JSON.stringify({
    tunnel: {
      pid: process.pid,
      executable_path: join(directory, "tunnel-client.exe"),
      profile: join(runRoot, "tunnel-profile.yaml"),
    },
  }), "utf8");
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const pluginManager = new TaskManager(join(tunnelRoot, "task_records.json"));
  const pluginTask = pluginManager.create({
    name: "ChatGPT plugin active turn",
    fingerprint: "runtime:plugin-thread:plugin-turn",
    execution_source: "external/native",
    status: "RUNNING",
    thread_id: "plugin-thread",
    turn_id: "plugin-turn",
    worker_id: null,
    active: true,
  });
  const server = new TaskStatusServer(statusStore, manager, new TaskRuntime(manager), {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    bridgeOwnedNativeTaskSource: {
      taskFilePath: join(tunnelRoot, "task_records.json"),
      tunnelStateFilePath: join(runRoot, "tunnel-state.json"),
      ownershipFilePath: join(runRoot, "desktop-ownership.json"),
      pidFilePath: join(runRoot, "tunnel-client.pid"),
      expectedPackageRoot: directory,
      hostStatusPort: 37_931,
      isProcessAlive: (pid) => pid === process.pid,
      pluginRuntimeIsLive: async () => true,
    },
    tunnelHealth: liveTunnelHealth,
  });
  try {
    const address = await server.start();
    const url = `http://127.0.0.1:${address.port}/api/status`;
    let body = await (await fetch(url)).json() as Record<string, any>;
    assert.equal(body.tasks.active.some((task: Record<string, unknown>) => task.id === pluginTask.id), true);
    assert.equal(body.control_center.activeNativeTurns.some((task: Record<string, unknown>) => task.id === pluginTask.id), true);
    assert.equal(body.workers.native_active, 1);
    assert.equal(body.dashboard.native_active_count, 1);

    pluginManager.update(pluginTask.id, { status: "COMPLETED" });
    body = await (await fetch(url)).json() as Record<string, any>;
    assert.equal(body.tasks.active.some((task: Record<string, unknown>) => task.id === pluginTask.id), false);
    assert.equal(body.control_center.activeNativeTurns.some((task: Record<string, unknown>) => task.id === pluginTask.id), false);
    assert.equal(body.workers.native_active, 0);
    assert.equal(body.dashboard.native_active_count, 0);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Control Center Native Threads API delegates to the official adapter and control surface", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-native-threads-api-"));
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const runtime = new TaskRuntime(manager);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const nativeAdapter = {
    async threadList(params: Record<string, unknown>) {
      assert.equal(params.limit, 10);
      return {
        data: [{
          id: "thread-ui-1",
          title: "BRIDGE_VISIBILITY_TEST_OK",
          cwd: { path: "C:\\Project" },
          status: { type: "idle" },
          updatedAt: 1_700_000_000,
          source: { type: "native-codex" },
          model: { id: "gpt-5.6-luna" },
        }],
        nextCursor: "next-ui-cursor",
      };
    },
    async threadRead(threadId: string, includeTurns: boolean) {
       assert.equal(threadId, "thread-ui-1");
       assert.equal(includeTurns, false);
       return {
        thread: {
          id: threadId,
          title: "BRIDGE_VISIBILITY_TEST_OK",
          cwd: "C:\\Project",
          status: "idle",
          turns: [{ role: "user", text: "只读检查" }],
        },
      };
    },
  } as any;
  const controlSurface = {
    async callForPlugin(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { accepted: true, thread_id: args.thread_id || "thread-ui-2", turn_id: "turn-ui-2" };
    },
  } as any;
  const server = new TaskStatusServer(statusStore, manager, runtime, {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    nativeAdapter,
    controlSurface,
  });
  try {
    const address = await server.start();
    const base = `http://127.0.0.1:${address.port}`;
    const fetch = await authorizedLocalFetch(base);
    const list = await fetch(base + "/api/native-threads?limit=10&search=BRIDGE_VISIBILITY_TEST_OK");
    assert.equal(list.status, 200);
    const listBody = await list.json() as Record<string, any>;
    assert.equal(listBody.source, "codex_app_server");
    assert.equal(listBody.data[0].id, "thread-ui-1");
    assert.equal(listBody.data[0].source, "native-codex");
    assert.equal(listBody.data[0].cwd, "C:\\Project");
    assert.equal(listBody.data[0].model, "gpt-5.6-luna");
    assert.equal(String(listBody.data[0].recencyLabel).includes("天前"), false);
    assert.equal(JSON.stringify(listBody.data[0]).includes("[object Object]"), false);
    assert.equal(listBody.nextCursor, "next-ui-cursor");

    const detail = await fetch(base + "/api/native-threads/thread-ui-1");
    assert.equal(detail.status, 200);
    assert.equal((await detail.json() as Record<string, any>).thread.id, "thread-ui-1");

    const created = await fetch(base + "/api/native-threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "创建持久会话", cwd: "C:\\Project", title: "UI test" }),
    });
    assert.equal(created.status, 202);

    const continued = await fetch(base + "/api/native-threads/thread-ui-1/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "继续这个线程" }),
    });
    assert.equal(continued.status, 202);

    const interrupted = await fetch(base + "/api/native-threads/thread-ui-1/interrupt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turn_id: "turn-ui-2" }),
    });
    assert.equal(interrupted.status, 202);
    assert.deepEqual(calls.map((call) => call.name), ["codex_turn", "codex_turn", "codex_interrupt"]);
    assert.equal(calls[1]?.args.thread_id, "thread-ui-1");
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Control Center Native Threads uses a bounded page and skips malformed records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-native-threads-bounded-api-"));
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const runtime = new TaskRuntime(manager);
  const observedLimits: unknown[] = [];
  const nativeAdapter = {
    async threadList(params: Record<string, unknown>) {
      observedLimits.push(params.limit);
      return {
        data: [
          null,
          { id: { invalid: true }, title: "没有稳定 ID 的历史记录" },
          { id: "thread-valid", title: "可读取的历史会话", status: "idle", updatedAt: 1_700_000_000 },
        ],
        nextCursor: "next-page",
      };
    },
  } as any;
  const server = new TaskStatusServer(statusStore, manager, runtime, {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    nativeAdapter,
  });
  try {
    const address = await server.start();
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + "/api/native-threads");
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.deepEqual(observedLimits, [20]);
    assert.deepEqual(body.data.map((item: Record<string, unknown>) => item.id), ["thread-valid"]);
    assert.equal(body.nextCursor, "next-page");

    const oversizedPage = await fetch(base + "/api/native-threads?limit=21");
    assert.equal(oversizedPage.status, 400);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AGENTS task detail and cancel control endpoints expose bounded task information", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-agents-control-api-"));
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const runtime = new TaskRuntime(manager);
  const task = manager.create({
    name: "AGENTS 控制面板测试",
    type: "ephemeral-codex",
    execution_source: "bridge",
    fingerprint: "agents-control-api",
    status: "RUNNING",
    progress: 35,
    stage: "tool execution",
    current_action: "正在执行命令",
    next_action: "整理输出",
    cwd: "C:\\Bridge",
    active: true,
  });
  runtime.progress(task.id, { stage: "tool execution", progress: 35, message: "正在执行命令", source: "test" });
  const fakeTaskService = {
    taskInput(taskId: string) {
      assert.equal(taskId, task.id);
      return "只读检查任务输入";
    },
    cancelTask(taskId: string) {
      assert.equal(taskId, task.id);
      return {
        accepted: true,
        task_id: task.id,
        status: "cancel_requested" as const,
        reason: null,
        cancel_requested: true,
        task: manager.get(task.id),
      };
    },
  } as any;
  const server = new TaskStatusServer(statusStore, manager, runtime, {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    taskService: fakeTaskService,
  });
  try {
    const address = await server.start();
    const base = `http://127.0.0.1:${address.port}`;
    const fetch = await authorizedLocalFetch(base);
    const detail = await fetch(base + "/api/service-codex/tasks/" + task.id);
    assert.equal(detail.status, 200);
    const detailBody = await detail.json() as Record<string, any>;
    assert.equal(detailBody.input, "只读检查任务输入");
    assert.equal(detailBody.task.id, task.id);
    assert.equal(Array.isArray(detailBody.events), true);
    assert.equal(detailBody.events.length > 0, true);
    assert.equal((detailBody.task.progress_view as Record<string, unknown>).phase_label, "执行中");

    const cancel = await fetch(base + "/api/service-codex/tasks/" + task.id + "/cancel", { method: "POST" });
    assert.equal(cancel.status, 202);
    const cancelBody = await cancel.json() as Record<string, any>;
    assert.equal(cancelBody.status, "cancel_requested");
    assert.equal(cancelBody.cancel_requested, true);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
