import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { normalizeLocalAbsolutePath } from "./local-path.js";

import { ModelGuard, type ModelGuardStatus } from "./model-guard.js";
import type { CodexAppServerAdapter } from "./app-server-adapter.js";
import { McpHealthState } from "./mcp-health.js";
import {
  canonicalizeRecordedOutputDirectory,
  isRecordedOutputDirectoryWithinRoots,
  openRecordedOutputDirectory,
  OutputDirectoryError,
} from "./output-directory.js";
import type { BridgeTaskScheduler } from "./ephemeral-scheduler.js";
import type { ServiceSessionManager } from "./service-session.js";
import { ResultReviewError } from "./result-service.js";
import {
  buildDashboardTaskProjection,
  type DashboardProjectionContext,
} from "./dashboard-projection.js";
import type { NativeStateReconciler } from "./native-state-reconciler.js";
import type { TaskService } from "./task-service.js";
import { sessionMapping } from "./session-mapping.js";
import { APP_SHELL_HTML } from "./control-center-shell.js";
import { STATUS_PAGE_HTML } from "./status-page.js";
import { deduplicateTaskEventViews, TaskEventStream, toTaskEventView, type TaskEventListOptions } from "./task-events.js";
import type { TaskDefinitionInput } from "./task-definition.js";
import type { LocalManifestUpdater } from "./updater.js";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  TaskManager,
  TaskManagerValidationError,
  TaskNotFoundError,
  type TaskLifecycle,
  type TaskRecord,
} from "./task-manager.js";
import { TaskRuntime } from "./task-runtime.js";
import { sanitizeForTransport, type RuntimeStore } from "./runtime.js";
import type { ControlSurface } from "./tools.js";
import {
  TaskStatusStore,
  TaskStatusValidationError,
} from "./task-status.js";
import { probeTunnelHealth, readTunnelHealth, type TunnelHealthView } from "./tunnel-health.js";
import {
  readBridgeOwnedNativeActiveTasks,
  type BridgeOwnedNativeTaskSource,
} from "./bridge-owned-native-tasks.js";
import {
  buildControlCenterState,
  normalizeNativeThreadRecord,
} from "./control-center-read-model.js";
import {
  readScheduledTasks,
  type ScheduledTasksSnapshot,
} from "./scheduled-tasks.js";
import {
  NATIVE_HISTORY_PAGE_SIZE,
  readNativeThreadHistory,
  type NativeThreadHistoryOptions,
  type NativeThreadHistoryReader,
} from "./native-history.js";
import { buildTaskProgressView } from "./task-progress-view.js";
import type { WorkingDirectoryTrace } from "./working-directory.js";
import { PortRegistry } from "./port-registry.js";
import { StartupSupervisor } from "./startup-supervisor.js";
import { LocalHttpSecurity, LocalHttpSecurityError } from "./local-http-security.js";
import { readBuildIdentity } from "./build-identity.js";

const STATUS_PATH = "/status";
const API_PATH = "/api/task-status";
const TASK_EVENTS_PATH = "/api/task-events";
const TASKS_PATH = "/api/tasks";
const NORMALIZED_STATUS_PATH = "/api/status";
const SERVICE_SESSIONS_PATH = "/api/service-sessions";
const SERVICE_TASKS_PATH = "/api/service-codex/tasks";
const MODEL_POLICY_PATH = "/api/model-policy";
const DIAGNOSTICS_PATH = "/api/diagnostics";
const APP_PATH = "/app";
const APP_EVENTS_PATH = "/api/events";
const DIRECTORY_VALIDATE_PATH = "/api/validate-directory";
const NATIVE_THREADS_PATH = "/api/native-threads";
const NATIVE_THREAD_PAGE_SIZE = 20;
const SCHEDULED_TASKS_PATH = "/api/scheduled-tasks";
const MAX_BODY_BYTES = 64 * 1024;

export interface TaskStatusServerOptions {
  port: number;
  modelGuard?: ModelGuard;
  scheduler?: BridgeTaskScheduler;
  nativeStateReconciler?: NativeStateReconciler;
  mcpHealth?: McpHealthState;
  taskService?: TaskService;
  serviceSessions?: ServiceSessionManager;
  updater?: LocalManifestUpdater;
  openOutputDirectory?: (directory: string) => string;
  nativeAdapter?: CodexAppServerAdapter;
  controlSurface?: ControlSurface;
  bridgeOwnedNativeTaskSource?: BridgeOwnedNativeTaskSource | null;
  tunnelHealth?: () => TunnelHealthView;
  scheduledTasks?: () => ScheduledTasksSnapshot;
  nativeHistory?: NativeThreadHistoryReader;
  workingDirectoryTrace?: () => WorkingDirectoryTrace | null;
  liveRuntime?: RuntimeStore;
  portRegistry?: PortRegistry;
  startupSupervisor?: StartupSupervisor;
}

export interface TaskStatusServerAddress {
  host: "127.0.0.1";
  port: number;
  url: string;
}

class HttpRequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpRequestError";
    this.statusCode = statusCode;
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function hashFile(path: string): string | null {
  try {
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

function controlCenterBuildInfo(): Record<string, unknown> {
  const root = process.cwd();
  const uiCandidates = [
    join(root, "dist", "control-center-shell.js"),
    join(root, "dist", "src", "control-center-shell.js"),
  ];
  const uiPath = uiCandidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) ?? null;
  const exePath = join(root, "LocalCodexBridge.exe");
  let exeExists = false;
  try {
    exeExists = statSync(exePath).isFile();
  } catch {
    exeExists = false;
  }
  return {
    label: readBuildIdentity(root).label,
    ui_bundle: uiPath ? uiPath.slice(root.length + 1).replaceAll("\\", "/") : null,
    ui_bundle_sha256: uiPath ? hashFile(uiPath) : null,
    loaded_asset: "/app (inline HTML)",
    loaded_asset_sha256: sha256(APP_SHELL_HTML),
    executable: exeExists ? "LocalCodexBridge.exe" : null,
    executable_sha256: exeExists ? hashFile(exePath) : null,
  };
}

function legacyStatus(value: TaskLifecycle): string {
  switch (value) {
    case "WAITING":
      return "queued";
    case "STARTING":
      return "starting";
    case "RUNNING":
      return "running";
    case "RETRYING":
      return "retrying";
    case "BLOCKED":
      return "blocked";
    case "RECOVERY_REQUIRED":
      return "recovery_required";
    case "PAUSED":
      return "paused";
    case "NEED_CONFIRM":
      return "need_confirm";
    case "DONE":
    case "COMPLETED":
      return "completed";
    case "INTERRUPTED":
    case "FAILED":
      return "failed";
  }
}

function taskView(task: TaskRecord): Record<string, unknown> {
  return {
    ...task,
    session: sessionMapping(task),
    task_id: task.id,
    task_name: task.name,
    task_title: task.name,
    progress_percent: task.progress,
    phase: task.stage,
    current_item: task.current_action,
    next_step: task.next_action,
    legacy_status: legacyStatus(task.status),
  };
}

function modelStatusView(status: ModelGuardStatus): Record<string, unknown> {
  return {
    model_guard: status,
    current_execution_model: status.current_execution_model,
    current_reasoning_effort: status.current_reasoning_effort,
    quota_mode: status.quota_mode,
    model_policy_status: status.model_policy_status,
  };
}

function currentStatus(
  store: TaskStatusStore,
  manager: TaskManager,
  modelStatus: ModelGuardStatus,
): Record<string, unknown> {
  const legacy = store.read();
  const snapshot = manager.snapshot();
  const current = manager.current();
  return {
    ...legacy,
    ...(current
      ? taskView(current)
      : {
          id: null,
          task_id: null,
          status: null,
        }),
    active_task_id: snapshot.active_task_id,
    tasks_count: snapshot.tasks.length,
    tasks: snapshot.tasks.map(taskView),
    recent_events: snapshot.events.slice(-20),
    task_manager_schema_version: snapshot.schema_version,
    task_manager_updated_at: snapshot.updated_at,
    ...modelStatusView(modelStatus),
  };
}

function taskCollection(
  store: TaskStatusStore,
  manager: TaskManager,
  modelStatus: ModelGuardStatus,
): Record<string, unknown> {
  const snapshot = manager.snapshot();
  return {
    ...snapshot,
    tasks: snapshot.tasks.map(taskView),
    events: snapshot.events.slice(-50),
    events_count: snapshot.events.length,
    bridge_status: store.read().bridge_status,
    current_task: manager.current() ? taskView(manager.current()!) : null,
    ...modelStatusView(modelStatus),
  };
}

function taskProjectionKey(task: TaskRecord): string {
  if (
    task.execution_source === "external/native" &&
    task.thread_id !== null &&
    task.turn_id !== null
  ) {
    return `native:${task.thread_id}\u0000${task.turn_id}`;
  }
  return `task:${task.id}`;
}

function mergeTaskProjection(
  primary: readonly TaskRecord[],
  bridgeOwnedNative: readonly TaskRecord[],
): TaskRecord[] {
  const merged = new Map<string, TaskRecord>();
  for (const task of primary) {
    merged.set(taskProjectionKey(task), task);
  }
  for (const task of bridgeOwnedNative) {
    const key = taskProjectionKey(task);
    const previous = merged.get(key);
    if (!previous || previous.updated_at.localeCompare(task.updated_at) < 0) {
      merged.set(key, task);
    }
  }
  return [...merged.values()];
}

async function normalizedStatus(
  store: TaskStatusStore,
  manager: TaskManager,
  modelGuard: ModelGuard,
  scheduler: BridgeTaskScheduler | undefined,
  mcpHealth: McpHealthState,
  serviceSessions?: ServiceSessionManager,
  bridgeOwnedNativeTaskSource?: BridgeOwnedNativeTaskSource | null,
  tunnelHealthReader: () => TunnelHealthView = readTunnelHealth,
  workingDirectoryTraceReader: () => WorkingDirectoryTrace | null = () => null,
  liveRuntime?: RuntimeStore,
  startupSupervisor?: StartupSupervisor,
): Promise<Record<string, unknown>> {
  const snapshot = manager.snapshot();
  const schedulerSnapshot = scheduler?.snapshot();
  const appServer = scheduler?.adapter.health() ?? null;
  const mcp = mcpHealth.status();
  const appServerState = appServer?.status.process_state ?? "not_started";
  const rawTunnel = tunnelHealthReader();
  const tunnel = await probeTunnelHealth(rawTunnel, tunnelHealthReader === readTunnelHealth);
  const bridgeOwnedNativeTasks = await readBridgeOwnedNativeActiveTasks(
    bridgeOwnedNativeTaskSource,
    tunnel,
  );
  const projectionTasks = mergeTaskProjection(snapshot.tasks, bridgeOwnedNativeTasks);
  const schedulerActiveTaskIds = schedulerSnapshot && "active" in schedulerSnapshot && Array.isArray(schedulerSnapshot.active)
    ? schedulerSnapshot.active
      .map((job) => isRecord(job) && typeof job.taskId === "string" ? job.taskId : null)
      .filter((taskId): taskId is string => taskId !== null)
    : [];
  const liveNativeTaskIds = liveRuntime
    ? projectionTasks
      .filter((task) => task.execution_source === "external/native" && task.thread_id !== null && task.turn_id !== null)
      .filter((task) => liveRuntime.activeTurnForThread(task.thread_id!) === task.turn_id)
      .map((task) => task.id)
    : [];
  const projectionContext: DashboardProjectionContext | undefined = scheduler || liveRuntime
    ? {
        live_task_ids: new Set([
          ...schedulerActiveTaskIds,
          ...liveNativeTaskIds,
          ...(schedulerSnapshot?.workers ?? [])
            .filter((worker) => worker.task_id !== null && worker.status !== "IDLE")
            .map((worker) => worker.task_id as string),
          ...bridgeOwnedNativeTasks.map((task) => task.id),
        ]),
        queued_task_ids: new Set(schedulerSnapshot?.waiting_task_ids ?? []),
        waiting_user_task_ids: new Set(
          liveRuntime
            ? projectionTasks
              .filter((task) => task.status === "NEED_CONFIRM" && task.thread_id !== null)
              .filter((task) => liveRuntime.pendingForThread(task.thread_id!).length > 0)
              .map((task) => task.id)
            : projectionTasks
              .filter((task) => task.status === "NEED_CONFIRM")
              .map((task) => task.id),
        ),
      }
    : undefined;
  const dashboard = buildDashboardTaskProjection(projectionTasks, projectionContext);
  const tunnelReady = tunnel.status === "running"
    && tunnel.registration === "ready"
    && tunnel.health_probe === "ok";
  const eventViews = deduplicateTaskEventViews(snapshot.events.slice(-100).map((event) => ({
    id: event.event_id,
    task_id: event.task_id,
    timestamp: event.at,
    type: event.type,
    stage: event.payload.stage ?? "",
    message: event.payload.message ?? event.payload.current_action ?? event.payload.item ?? "",
    progress: event.payload.progress ?? (event.status === "DONE" || event.status === "COMPLETED" ? 100 : 0),
    source: event.payload.source ?? "bridge",
  })));
  const taskViewWithProgress = (task: TaskRecord): Record<string, unknown> => {
    const taskEvents = eventViews.filter((event) => event.task_id === task.id);
    const cancelRequested = task.execution_source === "bridge" && scheduler?.cancelRequested?.(task.id) === true;
    return {
      ...taskView(task),
      events: taskEvents.slice(-20),
      progress_view: buildTaskProgressView(task, taskEvents),
      ...(cancelRequested ? { cancel_requested: true } : {}),
    };
  };
  const current = dashboard.current ? taskViewWithProgress(dashboard.current) : null;
  const bridgeRunning = schedulerSnapshot?.running_workers ?? 0;
  const taskViews = projectionTasks.map(taskViewWithProgress);
  const activeTaskViews = dashboard.active.map(taskViewWithProgress);
  const waitingTaskViews = dashboard.waiting.map(taskViewWithProgress);
  const attentionTaskViews = dashboard.attention.map(taskViewWithProgress);
  const recentCompletedViews = dashboard.recent_completed.map(taskViewWithProgress);
  const historyViews = dashboard.history.map(taskViewWithProgress);
  const pendingConfirmationViews = dashboard.pending_confirmations.map(taskViewWithProgress);
  const agents = scheduler?.agentsStatus?.() ?? {
    name: "AGENTS",
    technical_name: "Ephemeral Codex",
    owner: "bridge-task-runner",
    status: "not_reported",
    execution: "codex exec --ephemeral --json",
    persistent_threads: false,
    transcript_store: "bridge-task-history-only",
    max_jobs: 5,
    active_jobs: 0,
    queued_jobs: 0,
    native_subagents: "not_reported",
    subagent_active: 0,
    subagent_reported: false,
    capabilities: null,
  };
  const normalized = {
    updated_at: snapshot.updated_at,
    build: controlCenterBuildInfo(),
    working_directory: workingDirectoryTraceReader(),
    startup: startupSupervisor?.snapshot() ?? null,
    bridge: {
      product_name: "Local Codex Bridge",
      product_version: readBuildIdentity().version,
      status: store.read().bridge_status,
      pid: process.pid,
      runtime: "local-codex-bridge",
      version: readBuildIdentity().version,
      workspace: process.cwd(),
    },
    appServer,
    tunnel,
    plugin_bridge: {
      status: mcp.initialized || tunnelReady ? "ready" : "not_ready",
      transport: mcp.initialized ? mcp.endpoint : tunnelReady ? "tunnel" : mcp.endpoint,
      binding: mcp.initialized ? mcp.binding : tunnelReady ? "V6_TUNNEL" : mcp.binding,
      last_error: mcp.last_error,
    },
    native_session_transport: {
      status: appServerState === "running"
        ? "ready"
        : appServerState === "starting"
          ? "starting"
          : appServerState === "failed"
            ? "error"
            : "disconnected",
      process_state: appServerState,
      last_error: appServer?.status.last_error ?? appServer?.last_error ?? null,
    },
    agents,
    bridgeAgent: serviceSessions?.status() ?? agents,
    modelPolicy: modelGuard.status(),
    workers: schedulerSnapshot
      ? {
          running: bridgeRunning,
          bridge_running: bridgeRunning,
          native_active: dashboard.native_active_count,
          max: schedulerSnapshot.max_workers,
          slots: schedulerSnapshot.workers,
        }
      : { running: 0, bridge_running: 0, native_active: dashboard.native_active_count, max: 5, slots: [] },
    queue: {
      depth: schedulerSnapshot?.queue_depth ?? 0,
      waiting_task_ids: schedulerSnapshot?.waiting_task_ids ?? [],
      waiting_count: dashboard.waiting.length,
      retrying: dashboard.counts.RETRYING ?? 0,
      blocked: dashboard.counts.BLOCKED ?? 0,
    },
    tasks: {
      counts: dashboard.counts,
      active_task_id: snapshot.active_task_id,
      dashboard_current_task_id: current?.id ?? null,
      current_kind: dashboard.current_kind,
      current,
      active: activeTaskViews,
      waiting: waitingTaskViews,
      attention: attentionTaskViews,
      recent_completed: recentCompletedViews,
      history: historyViews,
      pending_confirmations: pendingConfirmationViews,
      items: taskViews,
      canonical_items: [...activeTaskViews, ...waitingTaskViews, ...attentionTaskViews, ...historyViews],
      recent: activeTaskViews.slice(0, 20),
    },
    dashboard: {
      current_kind: dashboard.current_kind,
      current_task_id: current?.id ?? null,
      active_count: dashboard.active.length,
      waiting_count: dashboard.waiting.length,
      attention_count: dashboard.attention.length,
      pending_confirmation_count: dashboard.pending_confirmations.length,
      recent_completed_count: dashboard.recent_completed.length,
      bridge_active_task_count: dashboard.bridge_active_count,
      native_active_count: dashboard.native_active_count,
    },
    activities: {
      bridge_scheduler: bridgeRunning,
      native_codex: dashboard.native_active_count,
      native_subagents: schedulerSnapshot?.native_subagents ?? {
        support: "not_reported",
        active: 0,
        max: 5,
        reported: false,
      },
      observe_requests: mcp.active_requests,
    },
    events: eventViews,
    writeClaims: scheduler?.claims.snapshot() ?? [],
    ephemeral_timings: scheduler?.timingHistory?.() ?? [],
    mcp,
  };
  return {
    ...normalized,
    control_center: buildControlCenterState(normalized),
  };
}

function syncLegacyCurrentStatus(store: TaskStatusStore, manager: TaskManager): void {
  const current = manager.current();
  if (!current) {
    return;
  }
  store.update({
    task_name: current.name,
    phase: current.stage,
    progress_percent: current.progress,
    completed_items: current.completed_items,
    current_item: current.current_action,
    next_step: current.next_action,
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new HttpRequestError(413, "request body is too large");
    }
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpRequestError(400, "request body must be valid JSON");
  }
}

function serviceTaskInput(value: unknown): TaskDefinitionInput {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("service task request must be a JSON object");
  }
  const allowed = new Set([
    "name",
    "title",
    "task_title",
    "text",
    "cwd",
    "fingerprint",
    "idempotency_key",
    "task_type",
    "task_complexity",
    "model",
    "effort",
    "approval_policy",
    "sandbox",
    "write_roots",
    "required_outputs",
    "existing_thread_id",
  ]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new TaskManagerValidationError("unsupported service task field: " + unknown);
  }
  if ("existing_thread_id" in value) {
    throw new TaskManagerValidationError("AGENTS tasks cannot provide existing_thread_id");
  }
  if (typeof value.text !== "string" || value.text.trim().length === 0) {
    throw new TaskManagerValidationError("text must be a non-empty string");
  }
  try { normalizeLocalAbsolutePath(typeof value.cwd === "string" ? value.cwd : ""); }
  catch { throw new TaskManagerValidationError("cwd must be an absolute local project directory"); }
  if ("approval_policy" in value && value.approval_policy !== "on-request") {
    throw new TaskManagerValidationError("AGENTS submission requires approval_policy on-request");
  }
  const sandbox = value.sandbox === undefined ? "read-only" : value.sandbox;
  if (sandbox !== "read-only" && sandbox !== "workspace-write") {
    throw new TaskManagerValidationError("sandbox must be read-only or workspace-write");
  }
  if ("write_roots" in value && (!Array.isArray(value.write_roots) || value.write_roots.some((item) => typeof item !== "string"))) {
    throw new TaskManagerValidationError("write_roots must be an array of strings");
  }
  if ("task_complexity" in value && value.task_complexity !== "normal" && value.task_complexity !== "high") {
    throw new TaskManagerValidationError("task_complexity must be normal or high");
  }
  const result: Record<string, unknown> = {
    text: value.text,
    cwd: value.cwd,
    sandbox,
    approval_policy: "on-request",
  };
  for (const field of ["name", "title", "task_title", "fingerprint", "idempotency_key", "task_type", "model", "effort"]) {
    if (!(field in value)) continue;
    if (typeof value[field] !== "string") {
      throw new TaskManagerValidationError(field + " must be a string");
    }
    result[field] = value[field];
  }
  if ("task_complexity" in value) result.task_complexity = value.task_complexity;
  if ("write_roots" in value) result.write_roots = value.write_roots;
  if ("required_outputs" in value) result.required_outputs = value.required_outputs;
  return result as unknown as TaskDefinitionInput;
}

function nativeThreadListParams(url: URL): Record<string, unknown> {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? NATIVE_THREAD_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > NATIVE_THREAD_PAGE_SIZE) {
    throw new HttpRequestError(400, `limit must be an integer from 1 to ${NATIVE_THREAD_PAGE_SIZE}`);
  }
  const cwd = url.searchParams.get("cwd")?.trim() ?? "";
  if (cwd) {
    try { normalizeLocalAbsolutePath(cwd); }
    catch { throw new HttpRequestError(400, "cwd must be an absolute local project directory"); }
  }
  const searchTerm = url.searchParams.get("search")?.trim() ?? "";
  const cursor = url.searchParams.get("cursor")?.trim() ?? "";
  return {
    limit,
    sortKey: "updated_at",
    sortDirection: "desc",
    ...(cwd ? { cwd } : {}),
    ...(searchTerm ? { searchTerm } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

function nativeThreadListResponse(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("thread/list returned no data array");
  }
  return {
    source: "codex_app_server",
    mode: "list",
    nextCursor: typeof value.nextCursor === "string" ? value.nextCursor : null,
    backwardsCursor: typeof value.backwardsCursor === "string" ? value.backwardsCursor : null,
    data: value.data.flatMap((thread) => {
      try {
        if (!isRecord(thread)) return [];
        const sanitized = sanitizeForTransport(thread, {
          maxStringChars: 4_000,
          maxDepth: 6,
          maxArrayItems: 20,
          maxObjectKeys: 60,
          totalCharBudget: 12_000,
        });
        const normalized = normalizeNativeThreadRecord(thread);
        if (!normalized.id) return [];
        return [isRecord(sanitized) ? { ...sanitized, ...normalized } : normalized];
      } catch {
        // One malformed historical record must not hide the rest of the page.
        return [];
      }
    }),
  };
}

function nativeThreadHistoryParams(url: URL): NativeThreadHistoryOptions {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? NATIVE_HISTORY_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > NATIVE_HISTORY_PAGE_SIZE) {
    throw new HttpRequestError(400, "history limit must be an integer from 1 to " + NATIVE_HISTORY_PAGE_SIZE);
  }
  const rawCursor = url.searchParams.get("cursor")?.trim() ?? "";
  if (rawCursor && !/^\d+$/.test(rawCursor)) {
    throw new HttpRequestError(400, "history cursor must be a non-negative integer");
  }
  const beforeOrdinal = rawCursor ? Number(rawCursor) : null;
  if (beforeOrdinal !== null && (!Number.isSafeInteger(beforeOrdinal) || beforeOrdinal < 0)) {
    throw new HttpRequestError(400, "history cursor must be a non-negative integer");
  }
  return { limit, beforeOrdinal };
}

function nativeTurnInput(value: unknown, threadId?: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TaskManagerValidationError("native turn request must be a JSON object");
  const allowed = new Set(["text", "cwd", "model", "effort", "sandbox", "approval_policy", "on_busy", "title", "required_outputs"]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TaskManagerValidationError("unsupported native turn field: " + unknown);
  if (typeof value.text !== "string" || value.text.trim().length === 0) {
    throw new TaskManagerValidationError("text must be a non-empty string");
  }
  const result: Record<string, unknown> = { text: value.text };
  if (threadId) result.thread_id = threadId;
  for (const field of ["cwd", "model", "effort", "sandbox", "approval_policy", "on_busy", "title"]) {
    if (field in value) {
      if (typeof value[field] !== "string") throw new TaskManagerValidationError(field + " must be a string");
      result[field] = value[field];
    }
  }
  if ("required_outputs" in value) result.required_outputs = value.required_outputs;
  return result;
}

export class TaskStatusServer {
  readonly #localHttpSecurity = new LocalHttpSecurity();
  readonly #store: TaskStatusStore;
  readonly #manager: TaskManager;
  readonly #runtime: TaskRuntime;
  readonly #events: TaskEventStream;
  readonly #modelGuard: ModelGuard;
  readonly #scheduler: BridgeTaskScheduler | undefined;
  readonly #nativeStateReconciler: NativeStateReconciler | undefined;
  readonly #mcpHealth: McpHealthState;
  readonly #taskService: TaskService | undefined;
  readonly #serviceSessions: ServiceSessionManager | undefined;
  readonly #updater: LocalManifestUpdater | undefined;
  readonly #openOutputDirectory: (directory: string) => string;
  readonly #nativeAdapter: CodexAppServerAdapter | undefined;
  readonly #controlSurface: ControlSurface | undefined;
  readonly #bridgeOwnedNativeTaskSource: BridgeOwnedNativeTaskSource | null;
  readonly #tunnelHealth: () => TunnelHealthView;
  readonly #scheduledTasks: () => ScheduledTasksSnapshot;
  readonly #nativeHistory: NativeThreadHistoryReader;
  readonly #workingDirectoryTrace: () => WorkingDirectoryTrace | null;
  readonly #liveRuntime: RuntimeStore | undefined;
  readonly #portRegistry: PortRegistry | undefined;
  readonly #startupSupervisor: StartupSupervisor | undefined;
  readonly #port: number;
  readonly #server: Server;
  readonly #sseClients = new Set<ServerResponse>();
  readonly #unsubscribeRuntime: () => void;
  #address: TaskStatusServerAddress | null = null;
  #startPromise: Promise<TaskStatusServerAddress> | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(
    store: TaskStatusStore,
    manager: TaskManager,
    runtime: TaskRuntime,
    options: TaskStatusServerOptions,
  ) {
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
      throw new Error("status server port must be an integer from 0 to 65535");
    }
    this.#store = store;
    this.#manager = manager;
    this.#runtime = runtime;
    this.#events = new TaskEventStream(manager, runtime);
    this.#modelGuard = options.modelGuard ?? new ModelGuard();
    this.#scheduler = options.scheduler;
    this.#nativeStateReconciler = options.nativeStateReconciler;
    this.#mcpHealth = options.mcpHealth ?? new McpHealthState();
    this.#taskService = options.taskService;
    this.#serviceSessions = options.serviceSessions;
    this.#updater = options.updater;
    this.#nativeAdapter = options.nativeAdapter ?? options.scheduler?.adapter;
    this.#controlSurface = options.controlSurface;
    this.#bridgeOwnedNativeTaskSource = options.bridgeOwnedNativeTaskSource ?? null;
    this.#tunnelHealth = options.tunnelHealth ?? readTunnelHealth;
    this.#scheduledTasks = options.scheduledTasks ?? readScheduledTasks;
    this.#nativeHistory = options.nativeHistory ?? readNativeThreadHistory;
    this.#workingDirectoryTrace = options.workingDirectoryTrace ?? (() => null);
    this.#liveRuntime = options.liveRuntime;
    this.#portRegistry = options.portRegistry;
    this.#startupSupervisor = options.startupSupervisor;
    this.#openOutputDirectory = options.openOutputDirectory ?? ((directory) =>
      openRecordedOutputDirectory(directory));
    this.#port = options.port;
    this.#unsubscribeRuntime = runtime.onEvent((event) => {
      this.#broadcast("change", { kind: "task-event", event: toTaskEventView(event) });
    });
    this.#server = createServer((request, response) => {
      void this.#handle(request, response);
    });
  }

  async start(): Promise<TaskStatusServerAddress> {
    if (this.#address) {
      return this.#address;
    }
    if (this.#startPromise) {
      return await this.#startPromise;
    }
    this.#startPromise = new Promise<TaskStatusServerAddress>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.#server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.#server.off("error", onError);
        const address = this.#server.address();
        if (!address || typeof address === "string") {
          reject(new Error("status server did not expose a TCP address"));
          return;
        }
        const info = address as AddressInfo;
        this.#address = {
          host: "127.0.0.1",
          port: info.port,
          url: `http://127.0.0.1:${info.port}${STATUS_PATH}`,
        };
        this.#portRegistry?.publishReady(info.port);
        this.#startupSupervisor?.component("Bridge Backend", "ready", {
          owner_pid: process.pid,
          last_success_at: new Date().toISOString(),
          failure_reason: null,
        });
        this.#startupSupervisor?.transition("HOST_READY", `status server bound 127.0.0.1:${info.port}`);
        resolve(this.#address);
      };
      this.#server.once("error", onError);
      this.#server.once("listening", onListening);
      try {
        this.#server.listen(this.#port, "127.0.0.1");
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return await this.#startPromise;
  }

  async close(): Promise<void> {
    if (this.#closePromise) {
      return await this.#closePromise;
    }
    this.#closePromise = (async (): Promise<void> => {
      this.#unsubscribeRuntime();
      for (const client of this.#sseClients) {
        try {
          client.end();
        } catch {
          // A disconnected SSE client is already closed.
        }
      }
      this.#sseClients.clear();
      await this.#startPromise?.catch(() => undefined);
      if (!this.#server.listening) {
        this.#portRegistry?.publishStopped();
        this.#startupSupervisor?.transition("STOPPED", "status server stopped");
        return;
      }
      await new Promise<void>((resolve, reject) => {
        this.#server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      this.#portRegistry?.publishStopped();
      this.#startupSupervisor?.transition("STOPPED", "status server stopped");
    })();
    return await this.#closePromise;
  }

  #broadcast(type: string, value: unknown): void {
    const data = JSON.stringify(value);
    if (!data) return;
    const message = "event: " + type + "\ndata: " + data + "\n\n";
    for (const client of this.#sseClients) {
      try {
        client.write(message);
      } catch {
        this.#sseClients.delete(client);
      }
    }
  }

  address(): TaskStatusServerAddress | null {
    return this.#address;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      this.#localHttpSecurity.validate(request, this.#address?.port ?? this.#port);
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const method = request.method ?? "GET";

      if (method === "GET" && url.pathname === "/api/local-session") {
        writeJson(response, 200, this.#localHttpSecurity.session(request));
        return;
      }

      if (method === "GET" && url.pathname === "/") {
        response.writeHead(302, {
          Location: STATUS_PATH,
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }
      if (method === "GET" && url.pathname === APP_PATH) {
        const html = this.#localHttpSecurity.render(APP_SHELL_HTML);
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(html),
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(html);
        return;
      }
      if (method === "GET" && url.pathname === APP_EVENTS_PATH) {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Connection": "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        });
        response.flushHeaders();
        this.#sseClients.add(response);
        response.write("event: ready\ndata: {\"product\":\"Local Codex Bridge\",\"protocol\":1}\n\n");
        request.on("close", () => this.#sseClients.delete(response));
        return;
      }
      if (method === "GET" && url.pathname === SCHEDULED_TASKS_PATH) {
        writeJson(response, 200, this.#scheduledTasks());
        return;
      }
      if (method === "GET" && url.pathname === STATUS_PATH) {
        const html = this.#localHttpSecurity.render(STATUS_PAGE_HTML);
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(html),
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(html);
        return;
      }
      if (method === "GET" && url.pathname === API_PATH) {
        writeJson(
          response,
          200,
          currentStatus(this.#store, this.#manager, this.#modelGuard.status()),
        );
        return;
      }
      if (method === "GET" && url.pathname === NORMALIZED_STATUS_PATH) {
        await this.#nativeStateReconciler?.ensureReconciled();
        writeJson(
          response,
          200,
          await normalizedStatus(
            this.#store,
            this.#manager,
            this.#modelGuard,
            this.#scheduler,
            this.#mcpHealth,
            this.#serviceSessions,
            this.#bridgeOwnedNativeTaskSource,
            this.#tunnelHealth,
            this.#workingDirectoryTrace,
            this.#liveRuntime,
            this.#startupSupervisor,
          ),
        );
        return;
      }
      const nativeThreadHistoryMatch = url.pathname.match(/^\/api\/native-threads\/([^/]+)\/history$/);
      if (nativeThreadHistoryMatch && method === "GET") {
        const threadId = decodeURIComponent(nativeThreadHistoryMatch[1] ?? "");
        if (!threadId) throw new HttpRequestError(400, "thread id is required");
        const result = this.#nativeHistory(threadId, nativeThreadHistoryParams(url));
        writeJson(response, 200, result);
        return;
      }
      if (method === "GET" && url.pathname === NATIVE_THREADS_PATH) {
        if (!this.#nativeAdapter) {
          writeJson(response, 503, { error: "native Codex thread service unavailable" });
          return;
        }
        const result = await this.#nativeAdapter.threadList(nativeThreadListParams(url));
        writeJson(response, 200, nativeThreadListResponse(result));
        return;
      }
      if (method === "POST" && url.pathname === NATIVE_THREADS_PATH) {
        if (!this.#controlSurface) {
          writeJson(response, 503, { error: "native Codex control service unavailable" });
          return;
        }
        const result = await this.#controlSurface.callForPlugin("codex_turn", nativeTurnInput(await readJson(request)));
        this.#broadcast("change", { kind: "native-turn-started", thread_id: (result as Record<string, unknown>).thread_id ?? null });
        writeJson(response, 202, result);
        return;
      }
      const nativeThreadMatch = url.pathname.match(/^\/api\/native-threads\/([^/]+)$/);
      if (nativeThreadMatch && method === "GET") {
        if (!this.#nativeAdapter) {
          writeJson(response, 503, { error: "native Codex thread service unavailable" });
          return;
        }
        const threadId = decodeURIComponent(nativeThreadMatch[1] ?? "");
        if (!threadId) throw new HttpRequestError(400, "thread id is required");
        // The Control Center only needs bounded thread metadata for the
        // detail header. Requesting every persisted turn here can make the
        // official app-server emit one JSONL response larger than the
        // transport safety limit for unusually large historical threads.
        // The list endpoint already supplies bounded recent metadata, while
        // Native turn supervision remains on the existing explicit paths.
        const result = await this.#nativeAdapter.threadRead(threadId, false);
        const sanitized = sanitizeForTransport(result, {
          maxStringChars: 8_000,
          maxDepth: 8,
          maxArrayItems: 100,
          maxObjectKeys: 80,
          totalCharBudget: 80_000,
        });
        const normalized = normalizeNativeThreadRecord(result);
        writeJson(response, 200, isRecord(sanitized)
          ? { ...sanitized, control_center: normalized }
          : { data: sanitized, control_center: normalized });
        return;
      }
      const nativeContinueMatch = url.pathname.match(/^\/api\/native-threads\/([^/]+)\/continue$/);
      if (nativeContinueMatch && method === "POST") {
        if (!this.#controlSurface) {
          writeJson(response, 503, { error: "native Codex control service unavailable" });
          return;
        }
        const threadId = decodeURIComponent(nativeContinueMatch[1] ?? "");
        if (!threadId) throw new HttpRequestError(400, "thread id is required");
        const result = await this.#controlSurface.callForPlugin("codex_turn", nativeTurnInput(await readJson(request), threadId));
        this.#broadcast("change", { kind: "native-turn-started", thread_id: threadId });
        writeJson(response, 202, result);
        return;
      }
      const nativeInterruptMatch = url.pathname.match(/^\/api\/native-threads\/([^/]+)\/interrupt$/);
      if (nativeInterruptMatch && method === "POST") {
        if (!this.#controlSurface) {
          writeJson(response, 503, { error: "native Codex control service unavailable" });
          return;
        }
        const threadId = decodeURIComponent(nativeInterruptMatch[1] ?? "");
        const body = await readJson(request);
        if (!isRecord(body) || typeof body.turn_id !== "string" || body.turn_id.trim().length === 0) {
          throw new TaskManagerValidationError("turn_id must be a non-empty string");
        }
        const result = await this.#controlSurface.callForPlugin("codex_interrupt", {
          thread_id: threadId,
          turn_id: body.turn_id,
        });
        this.#broadcast("change", { kind: "native-turn-interrupted", thread_id: threadId });
        writeJson(response, 202, result);
        return;
      }
      if (method === "GET" && url.pathname === SERVICE_SESSIONS_PATH) {
        const agents = this.#scheduler?.agentsStatus?.() ?? {
          name: "AGENTS",
          technical_name: "Ephemeral Codex",
          owner: "bridge-task-runner",
          status: "not_reported",
          execution: "codex exec --ephemeral --json",
          persistent_threads: false,
          transcript_store: "bridge-task-history-only",
          max_jobs: 5,
          active_jobs: 0,
          queued_jobs: 0,
          native_subagents: "not_reported",
          subagent_active: 0,
          subagent_reported: false,
          capabilities: null,
        };
        writeJson(response, 200, {
          source: "local_codex_bridge_agents",
          agents,
          bridge_agent: this.#serviceSessions?.status() ?? agents,
        });
        return;
      }
      if (method === "GET" && url.pathname === DIRECTORY_VALIDATE_PATH) {
        const directory = url.searchParams.get("path")?.trim() ?? "";
        let localPath = false;
        try {
          const normalized = normalizeLocalAbsolutePath(directory);
          localPath = process.platform === "win32" ? !normalized.startsWith("/") : normalized.startsWith("/");
        } catch { /* invalid input stays false */ }
        if (!localPath) {
          writeJson(response, 400, { valid: false, path: directory, error: "请选择或输入本机项目的绝对路径。" });
          return;
        }
        let valid = false;
        try { valid = statSync(directory).isDirectory(); } catch { valid = false; }
        if (!valid) {
          writeJson(response, 400, { valid: false, path: directory, error: "工作目录不存在，请重新选择。" });
          return;
        }
        writeJson(response, 200, { valid: true, path: directory });
        return;
      }
      if (method === "GET" && url.pathname === MODEL_POLICY_PATH) {
        const status = this.#modelGuard.status();
        writeJson(response, 200, {
          product_name: "Local Codex Bridge",
          policy: status,
          allowed_models: [...new Set([status.policy_model, status.default_model].filter((value): value is string => value !== null))],
          allowed_efforts: [status.policy_effort],
          safe_defaults: { sandbox: "read-only", approval_policy: "on-request" },
        });
        return;
      }
      if (method === "GET" && url.pathname === DIAGNOSTICS_PATH) {
        await this.#nativeStateReconciler?.ensureReconciled();
        writeJson(response, 200, {
          product_name: "Local Codex Bridge",
          status: await normalizedStatus(
            this.#store,
            this.#manager,
            this.#modelGuard,
            this.#scheduler,
            this.#mcpHealth,
            this.#serviceSessions,
            this.#bridgeOwnedNativeTaskSource,
            this.#tunnelHealth,
            this.#workingDirectoryTrace,
            this.#liveRuntime,
            this.#startupSupervisor,
          ),
          endpoints: {
            app: APP_PATH,
            status: STATUS_PATH,
            normalized_status: NORMALIZED_STATUS_PATH,
            events: APP_EVENTS_PATH,
            native_threads: NATIVE_THREADS_PATH,
            native_thread_history: NATIVE_THREADS_PATH + "/:id/history",
            scheduled_tasks: SCHEDULED_TASKS_PATH,
            service_tasks: SERVICE_TASKS_PATH,
          },
          updater: this.#updater?.snapshot() ?? {
            product: "Bridge Codex",
            channel: "local-dev",
            available: false,
            manifest_path: null,
            manifest: null,
            error: null,
            auto_apply: false,
          },
          safety: {
            loopback_only: true,
            service_submission: "ephemeral-codex-exec",
            approval_policy: "on-request",
            default_sandbox: "read-only",
            persistent_bridge_threads: false,
            auto_update: false,
          },
        });
        return;
      }
      const serviceTaskCancelMatch = url.pathname.match(/^\/api\/service-codex\/tasks\/([^/]+)\/cancel$/);
      if (serviceTaskCancelMatch && method === "POST") {
        if (!this.#taskService) {
          writeJson(response, 503, { error: "task service unavailable" });
          return;
        }
        const taskId = decodeURIComponent(serviceTaskCancelMatch[1] ?? "");
        if (!taskId) throw new HttpRequestError(400, "task id is required");
        const result = this.#taskService.cancelTask(taskId);
        if (!result.accepted) {
          writeJson(response, 409, result);
          return;
        }
        this.#broadcast("change", { kind: "task-cancel-requested", task_id: taskId });
        writeJson(response, 202, {
          ...result,
          task_title: result.task.name,
          task: taskView(result.task),
        });
        return;
      }
      const serviceTaskDetailMatch = url.pathname.match(/^\/api\/service-codex\/tasks\/([^/]+)$/);
      if (serviceTaskDetailMatch && method === "GET") {
        if (!this.#taskService) {
          writeJson(response, 503, { error: "task service unavailable" });
          return;
        }
        const taskId = decodeURIComponent(serviceTaskDetailMatch[1] ?? "");
        if (!taskId) throw new HttpRequestError(400, "task id is required");
        const task = this.#manager.get(taskId);
        if (task.execution_source !== "bridge") {
          writeJson(response, 404, { error: "AGENTS task was not found" });
          return;
        }
        const events = this.#events.list({ taskId, limit: 50 }).events;
        const cancelRequested = this.#scheduler?.cancelRequested?.(taskId) === true;
        const cancelled = task.status === "INTERRUPTED" && task.last_error === "任务已取消";
        writeJson(response, 200, {
          source: "local_codex_bridge_agents",
          task_id: taskId,
          input: this.#taskService.taskInput(taskId),
          events,
          output: {
            summary: task.result_summary || task.final_answer || null,
            files: [...task.output_files],
            directories: [...task.output_directories],
          },
          error: task.last_error,
          cancel_requested: cancelRequested,
          cancelled,
          task: {
            ...taskView(task),
            events,
            progress_view: buildTaskProgressView(task, events),
            ...(cancelRequested ? { cancel_requested: true } : {}),
            ...(cancelled ? { cancelled: true } : {}),
          },
        });
        return;
      }
      if (method === "POST" && url.pathname === SERVICE_TASKS_PATH) {
        if (!this.#taskService) {
          writeJson(response, 503, { error: "task service unavailable" });
          return;
        }
        const result = this.#taskService.submit(serviceTaskInput(await readJson(request)));
        this.#broadcast("change", { kind: "task-submitted", task_id: result.task_id });
        writeJson(response, 202, {
          ...result,
          execution_mode: "ephemeral-codex-exec",
          service_name: "AGENTS",
          persistent_thread: false,
          task_title: result.task.name,
          task: taskView(result.task),
        });
        return;
      }
      if ((method === "POST" || method === "PUT") && url.pathname === API_PATH) {
        const body = await readJson(request);
        const taskPatch = isRecord(body) ? { ...body } : body;
        if (isRecord(taskPatch) && "bridge_status" in taskPatch) {
          this.#store.update({ bridge_status: taskPatch.bridge_status });
          delete taskPatch.bridge_status;
        }
        this.#manager.updateCurrent(taskPatch);
        syncLegacyCurrentStatus(this.#store, this.#manager);
        writeJson(
          response,
          200,
          currentStatus(this.#store, this.#manager, this.#modelGuard.status()),
        );
        this.#broadcast("change", { kind: "task-updated", task_id: this.#manager.current()?.id ?? null });
        return;
      }
      if (method === "GET" && url.pathname === TASK_EVENTS_PATH) {
        const rawLimit = url.searchParams.get("limit");
        const options: TaskEventListOptions = {
          limit: rawLimit === null ? 50 : Number(rawLimit),
        };
        const taskId = url.searchParams.get("task_id");
        if (taskId !== null) {
          options.taskId = taskId;
        }
        const eventList = this.#events.list(options);
        writeJson(response, 200, {
          ...eventList,
          count: eventList.events.length,
          task_id: taskId,
          latest_event: eventList.events.at(-1) ?? null,
        });
        return;
      }
      if (method === "POST" && url.pathname === TASK_EVENTS_PATH) {
        const event = this.#events.record(await readJson(request));
        syncLegacyCurrentStatus(this.#store, this.#manager);
        writeJson(response, 201, {
          event,
          task: taskView(this.#manager.get(event.task_id)),
        });
        this.#broadcast("change", { kind: "legacy-event", task_id: event.task_id });
        return;
      }
      if (method === "GET" && url.pathname === TASKS_PATH) {
        writeJson(
          response,
          200,
          taskCollection(this.#store, this.#manager, this.#modelGuard.status()),
        );
        return;
      }
      if (method === "POST" && url.pathname === TASKS_PATH) {
        const task = this.#manager.create(await readJson(request));
        syncLegacyCurrentStatus(this.#store, this.#manager);
        writeJson(response, 201, {
          ...taskCollection(this.#store, this.#manager, this.#modelGuard.status()),
          created_task: taskView(task),
        });
        this.#broadcast("change", { kind: "task-created", task_id: task.id });
        return;
      }

      const eventsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/events$/);
      if (eventsMatch) {
        const taskId = decodeURIComponent(eventsMatch[1] ?? "");
        if (method === "GET") {
          const rawLimit = url.searchParams.get("limit");
          const limit = rawLimit === null ? 50 : Number(rawLimit);
          writeJson(response, 200, {
            task_id: taskId,
            events: this.#manager.eventsForTask(taskId, limit),
          });
          return;
        }
        if (method === "POST") {
          const event = this.#runtime.emit(taskId, await readJson(request));
          syncLegacyCurrentStatus(this.#store, this.#manager);
          writeJson(response, 201, {
            event,
            task: taskView(this.#manager.get(taskId)),
          });
          this.#broadcast("change", { kind: "task-event", task_id: taskId });
          return;
        }
      }

      const activateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/activate$/);
      if (method === "POST" && activateMatch) {
        const taskId = decodeURIComponent(activateMatch[1] ?? "");
        this.#manager.activate(taskId);
        syncLegacyCurrentStatus(this.#store, this.#manager);
        writeJson(
          response,
          200,
          taskCollection(this.#store, this.#manager, this.#modelGuard.status()),
        );
        this.#broadcast("change", { kind: "task-activated", task_id: taskId });
        return;
      }

      const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const taskId = decodeURIComponent(taskMatch[1] ?? "");
        if (method === "GET") {
          writeJson(response, 200, taskView(this.#manager.get(taskId)));
          return;
        }
        if (method === "PUT" || method === "PATCH") {
          const task = this.#manager.update(taskId, await readJson(request));
          syncLegacyCurrentStatus(this.#store, this.#manager);
          writeJson(response, 200, taskView(task));
          this.#broadcast("change", { kind: "task-updated", task_id: task.id });
          return;
        }
      }

      const continueMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/continue$/);
      if (method === "POST" && continueMatch) {
        if (!this.#taskService) {
          writeJson(response, 503, { error: "task service unavailable" });
          return;
        }
        const taskId = decodeURIComponent(continueMatch[1] ?? "");
        const body = await readJson(request);
        if (!isRecord(body) || typeof body.instruction !== "string" || body.instruction.trim().length === 0) {
          throw new TaskManagerValidationError("instruction must be a non-empty string");
        }
        const result = await this.#taskService.continueTask(taskId, body.instruction);
        syncLegacyCurrentStatus(this.#store, this.#manager);
        writeJson(response, result.accepted ? 202 : 409, {
          ...result,
          task_title: result.task.name,
          task: taskView(this.#manager.get(taskId)),
        });
        return;
      }

      const cancelMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
      if (method === "POST" && cancelMatch) {
        if (!this.#scheduler?.cancel) {
          writeJson(response, 503, { error: "ephemeral task scheduler unavailable" });
          return;
        }
        const taskId = decodeURIComponent(cancelMatch[1] ?? "");
        if (!this.#scheduler.cancel(taskId)) {
          throw new HttpRequestError(409, "task is not an active ephemeral Bridge job");
        }
        writeJson(response, 202, taskView(this.#manager.get(taskId)));
        this.#broadcast("change", { kind: "task-cancelled", task_id: taskId });
        return;
      }

      const outputMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/open-output(?:-directory)?$/);
      if (method === "POST" && outputMatch) {
        const taskId = decodeURIComponent(outputMatch[1] ?? "");
        const task = this.#manager.get(taskId);
        const directories = Array.isArray(task.output_directories)
          ? task.output_directories
          : [];
        if (directories.length === 0) {
          throw new HttpRequestError(409, "no recorded output directory is available");
        }
        let lastError: unknown = null;
        for (const directory of directories) {
          try {
            const canonical = canonicalizeRecordedOutputDirectory(directory);
            if (!isRecordedOutputDirectoryWithinRoots(canonical, [task.cwd, ...task.write_claims])) {
              throw new OutputDirectoryError("invalid", "recorded output directory is outside the task workspace scope");
            }
            const opened = this.#openOutputDirectory(canonical);
            writeJson(response, 200, {
              opened: true,
              task_id: task.id,
              directory: opened,
            });
            return;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError instanceof OutputDirectoryError) {
          throw new HttpRequestError(
            lastError.code === "unsupported" ? 501 : 409,
            lastError.message,
          );
        }
        throw new HttpRequestError(409, "recorded output directory is not available");
      }

      const sessionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/session$/);
      if (method === "GET" && sessionMatch) {
        const taskId = decodeURIComponent(sessionMatch[1] ?? "");
        writeJson(response, 200, sessionMapping(this.#manager.get(taskId)));
        return;
      }

      const resultMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/result$/);
      if (method === "GET" && resultMatch) {
        const taskId = decodeURIComponent(resultMatch[1] ?? "");
        const task = this.#manager.get(taskId);
        writeJson(response, 200, {
          ...task.result_manifest,
          task: taskView(task),
          result_manifest: task.result_manifest,
        });
        return;
      }
      const integrityMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/integrity$/);
      if (method === "POST" && integrityMatch) {
        if (!this.#scheduler) {
          writeJson(response, 503, { error: "result service unavailable" });
          return;
        }
        const taskId = decodeURIComponent(integrityMatch[1] ?? "");
        const manifest = this.#scheduler.resultService.refreshIntegrity(taskId);
        writeJson(response, 200, {
          task_id: taskId,
          result_manifest: manifest,
        });
        return;
      }
      const reviewMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/review$/);
      if (method === "POST" && reviewMatch) {
        if (!this.#scheduler) {
          writeJson(response, 503, { error: "result service unavailable" });
          return;
        }
        const taskId = decodeURIComponent(reviewMatch[1] ?? "");
        const manifest = this.#scheduler.resultService.markReviewed(taskId);
        writeJson(response, 200, {
          task_id: taskId,
          result_manifest: manifest,
        });
        return;
      }

      if (method === "GET" && url.pathname === "/api/task-manager") {
        writeJson(
          response,
          200,
          taskCollection(this.#store, this.#manager, this.#modelGuard.status()),
        );
        return;
      }

      writeJson(response, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof LocalHttpSecurityError) {
        writeJson(response, error.statusCode, { error: error.message });
        return;
      }
      if (error instanceof HttpRequestError) {
        writeJson(response, error.statusCode, { error: error.message });
        return;
      }
      if (error instanceof TaskStatusValidationError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      if (error instanceof TaskManagerValidationError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      if (error instanceof TaskNotFoundError) {
        writeJson(response, 404, { error: error.message });
        return;
      }
      if (error instanceof ResultReviewError) {
        writeJson(response, 409, { error: error.message });
        return;
      }
      writeJson(response, 500, { error: "status service unavailable" });
    }
  }
}
