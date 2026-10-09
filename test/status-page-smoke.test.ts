import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";

import { STATUS_PAGE_HTML } from "../src/status-page.js";

class FakeElement {
  textContent = "";
  className = "";
  type = "";
  title = "";
  disabled = false;
  onclick: (() => void) | null = null;
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  classList = {
    add: (...names: string[]) => {
      this.className = `${this.className} ${names.join(" ")}`.trim();
    },
    remove: (...names: string[]) => {
      this.className = this.className
        .split(/\s+/)
        .filter((name) => name && !names.includes(name))
        .join(" ");
    },
  };

  append(...items: FakeElement[]): void {
    this.children.push(...items);
  }

  replaceChildren(...items: FakeElement[]): void {
    this.children = [...items];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

function scriptSource(): string {
  const start = STATUS_PAGE_HTML.indexOf("<script>") + "<script>".length;
  const end = STATUS_PAGE_HTML.indexOf("</script>", start);
  assert.ok(start >= "<script>".length && end > start);
  return STATUS_PAGE_HTML.slice(start, end);
}

function task(source: "bridge" | "external/native", status = "RUNNING"): Record<string, unknown> {
  return {
    id: "task-1",
    name: "状态 smoke",
    status,
    progress: status === "COMPLETED" ? 100 : 30,
    stage: "执行",
    current_action: "检查状态",
    next_action: "继续工作",
    updated_at: "2026-08-26T01:00:00.000Z",
    completed_at: status === "COMPLETED" ? "2026-08-26T01:00:00.000Z" : null,
    result_summary: status === "COMPLETED" ? "已完成" : "",
    execution_source: source,
    output_files: [],
    output_directories: [],
    cwd: "C:\\Bridge",
    worker_id: source === "bridge" ? "luna-1" : null,
    thread_id: "thread-1",
    turn_id: "turn-1",
    result_manifest: {
      task_id: "task-1",
      task_title: "状态 smoke",
      execution_status: status,
      review_status: status === "COMPLETED" ? "READY" : "NOT_READY",
      thread_id: "thread-1",
      last_turn_id: "turn-1",
      worker_id: source === "bridge" ? "luna-1" : null,
      workspace: "C:\\Bridge",
      cwd: "C:\\Bridge",
      created_at: "2026-08-26T01:00:00.000Z",
      started_at: "2026-08-26T01:00:00.000Z",
      completed_at: status === "COMPLETED" ? "2026-08-26T01:00:00.000Z" : null,
      result_summary: status === "COMPLETED" ? "已完成" : "",
      output_files: [],
      output_directories: [],
      warnings: [],
      integrity: { status: "NOT_CHECKED", entries: [], warnings: [] },
      resume_command: "codex resume thread-1",
    },
  };
}

function snapshot(workerCount: number, confirmation = false): Record<string, unknown> {
  const current = task(workerCount > 0 ? "bridge" : "external/native", confirmation ? "NEED_CONFIRM" : "RUNNING");
  const slots = Array.from({ length: 5 }, (_, index) => ({
    worker_id: `luna-${index + 1}`,
    status: index < workerCount ? "RUNNING" : "IDLE",
    task_id: index < workerCount ? "task-1" : null,
    thread_id: index < workerCount ? "thread-1" : null,
    turn_id: index < workerCount ? "turn-1" : null,
    phase: index < workerCount ? "running" : "idle",
    policy_model: "gpt-5.6-luna",
    policy_effort: "max",
    requested_model: null,
    requested_effort: "max",
    observed_model: "gpt-5.6-luna",
    observed_effort: "max",
    write_claim: null,
    last_event: "2026-08-26T01:00:00.000Z",
    error: null,
    retry_count: 0,
  }));
  const groups = confirmation ? { active: [current], waiting: [], recent_completed: [], history: [], pending_confirmations: [current] } : { active: [current], waiting: [], recent_completed: [], history: [], pending_confirmations: [] };
  return {
    _source: "primary",
    updated_at: "2026-08-26T01:00:00.000Z",
    bridge: { status: "running", pid: 1234, runtime: "local-codex-bridge", version: "5.0.0-bridge-agent-desktop" },
    appServer: { status: { process_state: "running", transport: "stdio", app_server_pid: 5678 } },
    modelPolicy: { policy_model: "gpt-5.6-luna", policy_effort: "max", observed_model: "gpt-5.6-luna", observed_effort: "max", guard_status: "READY", model_policy_status: "active" },
    workers: { running: workerCount, bridge_running: workerCount, native_active: workerCount === 0 ? 1 : 0, max: 5, slots },
    queue: { depth: workerCount === 5 ? 1 : 0, waiting_task_ids: ["task-6"], waiting_count: workerCount === 5 ? 1 : 0, retrying: 0, blocked: 0 },
    tasks: { items: [current], current, current_kind: "active", active: groups.active, waiting: groups.waiting, recent_completed: groups.recent_completed, history: groups.history, pending_confirmations: groups.pending_confirmations, counts: { [current.status as string]: 1 } },
    dashboard: { current_kind: "active", current_task_id: "task-1", active_count: 1, waiting_count: 0, pending_confirmation_count: groups.pending_confirmations.length },
    activities: { bridge_scheduler: workerCount, native_codex: workerCount === 0 ? 1 : 0, observe_requests: 0 },
    events: [],
    writeClaims: confirmation ? [{ claim_id: "claim-1" }] : [],
    mcp: { endpoint: "stdio", binding: "ACTIVE_SESSION", chatgpt_conversation_binding: "UNKNOWN" },
  };
}

function createPageHarness(initial: Record<string, unknown>): {
  elements: Map<string, FakeElement>;
  intervals: Array<() => Promise<void>>;
  setMode: (mode: "success" | "fail" | "compatibility") => void;
} {
  const ids = [
    "connection", "bridgeStatus", "codexStatus", "modelSummary", "overallStatus", "confirmationCount", "queueCount", "confirmationAlert", "confirmationSummary", "confirmationList",
    "currentStatus", "currentName", "currentKind", "currentMeta", "currentStage", "currentAction", "nextAction", "executionSource", "resultSummary", "outputSummary", "sessionDetailText",
    "openOutputDirectory", "markReviewed", "copySessionCommand", "progressPercent", "progressBar", "progressTrack", "bridgeSlots", "nativeActivity", "waitingTasksCount", "workerCards",
    "runningTasks", "waitingTasks", "historyTasks", "toggleHistory", "bridgeRuntime", "appServerHealth", "mcpEndpoint", "mcpBinding", "guardHealth", "requiredModel", "requiredEffort",
    "writeConflicts", "recoveryNeeded", "observeRequests", "bridgePid", "appServerPid", "apiState", "recentEvent", "stageChanges", "progressChanges", "eventTimeline",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  const intervals: Array<() => Promise<void>> = [];
  let mode: "success" | "fail" | "compatibility" = "success";
  const document = { getElementById: (id: string) => elements.get(id) ?? null, createElement: () => new FakeElement() };
  const response = (value: unknown, ok = true, status = 200) => ({ ok, status, json: async () => value });
  const fetch = async (url: string) => {
    if (mode === "fail") return response({ error: "down" }, false, 503);
    if (url === "/api/status") return response(mode === "compatibility" ? { legacy: true } : initial);
    if (url === "/api/tasks") return response({ tasks: [task("external/native")], bridge_status: "running", model_guard: { policy_model: "gpt-5.6-luna", policy_effort: "max" } });
    if (url.startsWith("/api/task-events")) return response({ events: [] });
    return response({}, false, 404);
  };
  const context = vm.createContext({ document, fetch, setInterval: (callback: () => Promise<void>) => { intervals.push(callback); return intervals.length; }, console, Date, Map, String, Number, Array, Math });
  new vm.Script(scriptSource()).runInContext(context);
  return { elements, intervals, setMode: (next) => { mode = next; } };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("frontend smoke renders the Chinese daily overview and separates native activity", async () => {
  const harness = createPageHarness(snapshot(0));
  await settle();
  assert.equal(harness.elements.get("bridgeStatus")!.textContent, "已连接");
  assert.equal(harness.elements.get("codexStatus")!.textContent, "正常");
  assert.equal(harness.elements.get("modelSummary")!.textContent, "Luna Max");
  assert.equal(harness.elements.get("bridgeSlots")!.textContent, "0 / 5");
  assert.equal(harness.elements.get("nativeActivity")!.textContent, "1");
  assert.equal(harness.elements.get("executionSource")!.textContent, "Codex 原生任务");
  assert.equal(harness.elements.get("workerCards")!.children.length, 1);
  assert.match(STATUS_PAGE_HTML, /技术详情/);
  assert.match(STATUS_PAGE_HTML, /执行详情与实时事件日志/);
  assert.match(STATUS_PAGE_HTML, /<details id="technicalDetails"/);
  assert.match(STATUS_PAGE_HTML, /<details id="executionDetails"/);
  assert.doesNotMatch(STATUS_PAGE_HTML, /<details[^>]+open/);
  assert.doesNotMatch(STATUS_PAGE_HTML, /Execution Status/);
});

test("frontend smoke renders 5/5 slots and emphasizes confirmation", async () => {
  const harness = createPageHarness(snapshot(5, true));
  await settle();
  assert.equal(harness.elements.get("bridgeSlots")!.textContent, "5 / 5");
  assert.equal(harness.elements.get("confirmationCount")!.textContent, "1");
  assert.equal(harness.elements.get("confirmationAlert")!.style.display, "block");
  assert.equal(harness.elements.get("workerCards")!.children.length, 5);
  assert.equal(harness.elements.get("executionSource")!.textContent, "Bridge AGENTS · ephemeral");
});

test("frontend smoke shows explicit API failure and reconnects", async () => {
  const harness = createPageHarness(snapshot(0));
  await settle();
  harness.setMode("fail");
  await harness.intervals[0]!();
  await settle();
  assert.match(harness.elements.get("connection")!.textContent, /Bridge unavailable/);
  harness.setMode("success");
  await harness.intervals[0]!();
  await settle();
  assert.match(harness.elements.get("connection")!.textContent, /本机接口已连接/);
});

test("frontend smoke falls back from incompatible primary snapshot", async () => {
  const harness = createPageHarness(snapshot(0));
  harness.setMode("compatibility");
  await harness.intervals[0]!();
  await settle();
  assert.match(harness.elements.get("connection")!.textContent, /本机接口已连接/);
  assert.equal(harness.elements.get("bridgeSlots")!.textContent, "0 / 5");
});
