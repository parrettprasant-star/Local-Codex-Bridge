import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { APP_SHELL_HTML } from "../src/control-center-shell.js";
import { McpHealthState } from "../src/mcp-health.js";
import { ModelGuard } from "../src/model-guard.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskRuntime } from "../src/task-runtime.js";
import { TaskStatusServer, authorizedLocalFetch } from "./browser-safe-status-server.js";
import type { TaskDefinitionInput } from "../src/task-definition.js";
import type { TaskService } from "../src/task-service.js";
import { TaskStatusStore } from "../src/task-status.js";

test("Local Codex Bridge V6.1 shell contains the Control Center vertical slice", () => {
  for (const required of [
    "Local Codex Bridge",
    "task-progress-panel",
    "task-progress-track",
    "task-progress-steps",
    "任务分类",
    "完成时间",
    "输出摘要",
    "输出位置",
    "失败阶段",
    "错误原因",
    "最后成功步骤",
    "progress_view",
    "taskDetailDrawer",
    "taskDetailContent",
    "data-task-view",
    "data-task-cancel",
    "取消任务",
    "取消中",
    "cancel_requested",
    "RECOVERY_REQUIRED",
    "需要处理",
    "结束任务",
    "输入任务",
    "最近事件",
    "/api/service-codex/tasks/",
    "/cancel",
    "总览",
    "Native Threads",
    "Scheduled Tasks",
    "诊断",
    "ControlCenterState",
    "controlCenterState",
    "normalizeTimestamp",
    "thread/list",
    "thread/read",
    "AGENTS",
    "persistent",
    "ephemeral",
    "final_answer",
    "taskFlow",
    "composer",
    "model",
    "effort",
    "diagnosticTunnel",
    "diagnosticTunnelRegistration",
    "Plugin transport",
    "Native session transport",
    "状态概览",
    "展开执行详情",
    "旧版状态页",
    "target=\"_blank\"",
    "--content-max: 1320px",
    "任务标题",
    "工作目录",
    "选择文件夹",
    "GPT-5.6 Luna",
    "推理强度",
    "Max",
    "readonly-control",
    "data-value=\"gpt-5.6-luna\"",
    "锁定",
    "/api/validate-directory",
    "select-folder",
    "event.preventDefault()",
    "event.stopPropagation()",
    "webview.postMessage({ type: \"select-folder\" })",
    "folder-picker-cancelled",
    "请先选择工作目录",
    "复制诊断信息",
    "查看原始 JSON",
    "EventSource",
    "/api/status",
    "/api/diagnostics",
    "/api/native-threads",
    "/history?",
    "loadNativeHistory",
    "历史较大，已分页加载",
    "nativeHistoryMore",
    "加载更早内容",
    'params.set("limit", "20")',
    "/api/scheduled-tasks",
    "/api/service-sessions",
    "/api/service-codex/tasks",
    "/status",
    "Bridge 创建",
    "原生 Codex",
    "暂无 Native Threads",
    "nativeContinueForm",
    "继续这个线程",
    "最近失败",
    "已就绪",
    "待启动",
    "displayCwd",
    "diagnosticBuild",
    "diagnosticUiBundleHash",
    "diagnosticExeHash",
    "diagnosticLoadedAssetHash",
    "shortHash",
    "clientFallback",
    "Control Center failed to load",
    "window.onerror",
    "unhandledrejection",
    "client-error",
    "重新加载",
    "打开诊断",
    "clientFallbackReload",
    "__bridgeReportClientError",
    "controlCenterReady",
    ".main { min-width: 0; min-height: 0;",
    ".native-layout { display: grid; min-height: 0;",
    ".detail-panel { position: sticky; top: 0; display: flex;",
    "max-height: min(720px, calc(100vh - 170px));",
    ".native-detail-scroll { min-height: 0; flex: 1 1 auto; overflow-y: auto;",
    "overscroll-behavior: contain",
    ".turn-list { display: grid; gap: 9px; max-height: none; overflow: visible;",
  ]) {
    assert.equal(APP_SHELL_HTML.includes(required), true, "missing app shell marker: " + required);
  }
  assert.equal(APP_SHELL_HTML.includes("react"), false);
  assert.equal(APP_SHELL_HTML.includes("vite"), false);
  assert.equal(APP_SHELL_HTML.includes("class=\"legacy-link\" href=\"/status\""), false);
  assert.equal(APP_SHELL_HTML.includes("id=\"legacyStatusLink\" href=\"/status\" target=\"_blank\""), true);
  assert.equal(APP_SHELL_HTML.includes("<select id=\"model\""), false);
  assert.equal(APP_SHELL_HTML.includes("<select id=\"effort\""), false);
  assert.equal(APP_SHELL_HTML.indexOf("legacyStatusLink") > APP_SHELL_HTML.indexOf("高级工具"), true);
  assert.equal(APP_SHELL_HTML.includes("page-overview"), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"composer\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"agentComposerWrap\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"page-overview\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"page-native\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"page-agents\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"page-scheduled\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"page-diagnostics\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"scheduledTasksContent\""), true);
  assert.equal(APP_SHELL_HTML.includes("page-overview") && APP_SHELL_HTML.indexOf("id=\"composer\"") > APP_SHELL_HTML.indexOf("id=\"page-agents\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"overviewThreads\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"nativeList\""), true);
  assert.equal(APP_SHELL_HTML.includes("id=\"diagnosticsContent\""), true);
  assert.equal(APP_SHELL_HTML.includes("slice(0, 5)"), true);
  assert.equal(APP_SHELL_HTML.includes("[object Object]"), false);
  assert.equal(APP_SHELL_HTML.includes("tasks.attention"), true);
  assert.equal(APP_SHELL_HTML.includes("来源未报告"), false);
  assert.equal(APP_SHELL_HTML.includes("native-full-row"), true);
  assert.equal(APP_SHELL_HTML.includes('class="surface-body native-detail-scroll" id="nativeDetail"'), true);
  assert.equal(APP_SHELL_HTML.includes(".native-detail-scroll { min-height: 0; flex: 1 1 auto; overflow-y: auto;"), true);
  assert.equal(APP_SHELL_HTML.includes(".turn-list { display: grid; gap: 9px; max-height: none; overflow: visible;"), true);
});

test("app route, SSE, guard API, diagnostics, and safe AGENTS submission are connected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-v6-app-"));
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const runtime = new TaskRuntime(manager);
  let received: TaskDefinitionInput | null = null;
  const taskService = {
    submit(input: TaskDefinitionInput) {
      received = input;
      const task = manager.create({
        name: input.title ?? input.name ?? "Local Codex Bridge app task",
        type: "Codex 原生任务",
        execution_source: "bridge",
        fingerprint: "app-shell-test-task",
        status: "WAITING",
        cwd: input.cwd,
        write_claims: input.write_roots ?? [],
        active: true,
      });
      return {
        accepted: true as const,
        deduplicated: false,
        task,
        task_id: task.id,
        status: task.status,
      };
    },
  } as unknown as TaskService;
  const server = new TaskStatusServer(statusStore, manager, runtime, {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    taskService,
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const address = await server.start();
    const base = "http://127.0.0.1:" + address.port;
    const fetch = await authorizedLocalFetch(base);
    const app = await fetch(base + "/app");
    assert.equal(app.status, 200);
    assert.match(await app.text(), /Local Codex Bridge/);

    const legacy = await fetch(base + "/status");
    assert.equal(legacy.status, 200);
    const model = await fetch(base + "/api/model-policy");
    const modelBody = await model.json() as Record<string, any>;
    assert.equal(modelBody.product_name, "Local Codex Bridge");
    assert.deepEqual(modelBody.allowed_efforts, ["max"]);

    const validDirectory = await fetch(base + "/api/validate-directory?path=" + encodeURIComponent(process.cwd()));
    assert.equal(validDirectory.status, 200);
    assert.equal((await validDirectory.json() as Record<string, unknown>).valid, true);
    const invalidDirectory = await fetch(base + "/api/validate-directory?path=" + encodeURIComponent("C:\\__local_codex_bridge_missing__"));
    assert.equal(invalidDirectory.status, 400);
    assert.equal((await invalidDirectory.json() as Record<string, unknown>).error, "工作目录不存在，请重新选择。");

    const diagnostics = await fetch(base + "/api/diagnostics");
    const diagnosticsBody = await diagnostics.json() as Record<string, any>;
    assert.equal(diagnosticsBody.safety.approval_policy, "on-request");
    assert.equal(diagnosticsBody.safety.auto_update, false);

    const stream = await fetch(base + "/api/events");
    assert.equal(stream.status, 200);
    reader = stream.body!.getReader();
    const initial = await reader.read();
    assert.match(new TextDecoder().decode(initial.value), /event: ready/);

    const submitted = await fetch(base + "/api/service-codex/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "来自 Local Codex Bridge",
        text: "只读检查任务",
        cwd: "C:\\\\Bridge",
        model: "gpt-5.6-luna",
        effort: "max",
      }),
    });
    assert.equal(submitted.status, 202);
    const submittedBody = await submitted.json() as Record<string, any>;
    assert.equal(submittedBody.execution_mode, "ephemeral-codex-exec");
    assert.ok(received);
    const receivedInput = received as TaskDefinitionInput;
    assert.equal(receivedInput.approval_policy, "on-request");
    assert.equal(receivedInput.sandbox, "read-only");
    assert.equal(receivedInput.existing_thread_id, undefined);

    const change = await reader.read();
    assert.match(new TextDecoder().decode(change.value), /event: change/);

    const unsafe = await fetch(base + "/api/service-codex/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "不应使用 never",
        cwd: "C:\\\\Bridge",
        approval_policy: "never",
      }),
    });
    assert.equal(unsafe.status, 400);
  } finally {
    if (reader) await reader.cancel();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
