export type ControlCenterSubsystemState =
  | "connected"
  | "ready"
  | "starting"
  | "waiting"
  | "not_configured"
  | "disconnected"
  | "error";

export interface ControlCenterSubsystem {
  state: ControlCenterSubsystemState;
  label: string;
  detail: string | null;
}

export interface NativeThreadReadModel {
  id: string;
  title: string;
  status: string;
  cwd: string | null;
  source: string | null;
  model: string | null;
  gitInfo: string | null;
  updatedAt: string | null;
  recencyAt: string | null;
  recencyLabel: string;
  displayCwd: string | null;
}

export interface ControlCenterState {
  source: "normalized_status";
  updatedAt: string | null;
  bridge: ControlCenterSubsystem;
  tunnel: ControlCenterSubsystem & { registration: ControlCenterSubsystemState };
  plugin: ControlCenterSubsystem;
  codex: ControlCenterSubsystem;
  activeNativeTurns: Record<string, unknown>[];
  agentJobs: {
    running: number;
    queued: number;
    max: number;
    recentFailures: number;
  };
  workers: {
    running: number;
    nativeActive: number;
    max: number;
  };
  queue: {
    depth: number;
    pending: number;
  };
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function scalarText(
  value: unknown,
  preferredFields: readonly string[] = ["label", "name", "type", "value"],
): string | null {
  const direct = nonEmptyString(value);
  if (direct) return direct;
  const number = finiteNumber(value);
  if (number !== null) return String(number);
  const object = record(value);
  if (!object) return null;
  for (const field of preferredFields) {
    const nested = scalarText(object[field]);
    if (nested) return nested;
  }
  return null;
}

function firstValue(object: UnknownRecord, fields: readonly string[]): unknown {
  for (const field of fields) {
    if (field in object && object[field] !== null && object[field] !== undefined) {
      return object[field];
    }
  }
  return null;
}

/** Normalize both Unix seconds and Unix milliseconds to epoch milliseconds. */
export function normalizeTimestamp(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric !== null) {
    const milliseconds = Math.abs(numeric) < 100_000_000_000
      ? numeric * 1_000
      : numeric;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  const direct = nonEmptyString(value);
  if (direct) {
    const parsedNumeric = finiteNumber(direct);
    if (parsedNumeric !== null) return normalizeTimestamp(parsedNumeric);
    const parsedDate = Date.parse(direct);
    return Number.isFinite(parsedDate) ? parsedDate : null;
  }
  const object = record(value);
  if (!object) return null;
  return normalizeTimestamp(firstValue(object, [
    "timestamp",
    "time",
    "value",
    "updatedAt",
    "updated_at",
    "recencyAt",
    "recency_at",
    "createdAt",
    "created_at",
  ]));
}

export function formatRelativeTimestamp(value: unknown, now = Date.now()): string {
  const timestamp = normalizeTimestamp(value);
  if (timestamp === null) return "未报告";
  const delta = now - timestamp;
  if (delta < 0 || delta < 10_000) return "刚刚";
  const seconds = Math.floor(delta / 1_000);
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;

  const then = new Date(timestamp);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  if (startOfToday - startOfThen === 86_400_000) return "昨天";
  if (then.getFullYear() === today.getFullYear()) return `${then.getMonth() + 1}月${then.getDate()}日`;
  return `${then.getFullYear()}年${then.getMonth() + 1}月${then.getDate()}日`;
}

export function shortenWindowsPath(value: unknown, maxLength = 48): string | null {
  const path = scalarText(value, ["path", "fullPath", "absolutePath", "cwd", "value"]);
  if (!path) return null;
  if (path.length <= maxLength) return path;
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) return path.slice(0, Math.max(0, maxLength - 1)) + "…";
  const suffix = parts.slice(-2).join(separator);
  const prefix = path.match(/^[A-Za-z]:/)?.[0] ?? "";
  const result = `${prefix}${separator}…${separator}${suffix}`;
  return result.length <= maxLength ? result : result.slice(0, Math.max(0, maxLength - 1)) + "…";
}

function statusValue(value: unknown): string {
  return (scalarText(value, ["status", "state", "process_state", "type", "value", "label"]) ?? "").toLowerCase();
}

function subsystem(value: unknown, kind: "bridge" | "tunnel" | "plugin" | "codex"): ControlCenterSubsystem {
  const raw = statusValue(value);
  if (kind === "bridge" && ["running", "connected", "ready"].includes(raw)) {
    return { state: "connected", label: "已连接", detail: null };
  }
  if (["ready", "running", "connected", "idle"].includes(raw)) {
    return { state: "ready", label: "已就绪", detail: null };
  }
  if (["starting", "registering", "opening", "initializing"].includes(raw)) {
    return { state: "starting", label: "启动中", detail: null };
  }
  if (["not_started", "waiting", "lazy", "pending"].includes(raw)) {
    return { state: "waiting", label: "待启动", detail: null };
  }
  if (["not_configured", "not_registered"].includes(raw)) {
    return { state: "not_configured", label: "未配置", detail: null };
  }
  if (["disconnected", "not_ready"].includes(raw)) {
    return { state: "disconnected", label: "未连接", detail: null };
  }
  if (["failed", "error", "fatal"].includes(raw)) {
    return { state: "error", label: "异常", detail: null };
  }
  return { state: "disconnected", label: "未连接", detail: null };
}

function isNativeTask(value: unknown): value is Record<string, unknown> {
  const object = record(value);
  if (!object) return false;
  const source = statusValue(firstValue(object, ["execution_source", "source", "type"]));
  return source.includes("native") || source.includes("external") || typeof object.thread_id === "string";
}

function count(value: unknown, fallback = 0): number {
  const result = finiteNumber(value);
  return result === null || result < 0 ? fallback : Math.floor(result);
}

export function buildControlCenterState(value: unknown): ControlCenterState {
  const status = record(value) ?? {};
  const bridge = subsystem(status.bridge, "bridge");
  const tunnelObject = record(status.tunnel) ?? {};
  const tunnelStatus = subsystem(tunnelObject.status ?? tunnelObject, "tunnel");
  const registration = subsystem(tunnelObject.registration, "tunnel");
  const plugin = subsystem(status.plugin_bridge, "plugin");
  const appServer = record(status.appServer) ?? record(status.app_server) ?? {};
  const nativeTransport = record(status.native_session_transport) ?? {};
  const appServerRaw = statusValue(firstValue(appServer, ["process_state", "status"])) || "not_started";
  const nativeTransportRaw = statusValue(nativeTransport.status);
  const codexRaw = appServerRaw === "running"
    ? "running"
    : nativeTransportRaw === "disconnected" && appServerRaw === "not_started"
      ? "not_started"
      : nativeTransport.status ?? appServer.process_state ?? appServer.status;
  const codex = subsystem(codexRaw, "codex");
  const tasks = record(status.tasks) ?? {};
  const active = Array.isArray(tasks.active) ? tasks.active.filter(isNativeTask) : [];
  const agents = record(status.agents) ?? {};
  const workersObject = record(status.workers) ?? {};
  const queueObject = record(status.queue) ?? {};
  const recentTasks = Array.isArray(tasks.items) ? tasks.items : [];
  const recentFailures = recentTasks.filter((task) => {
    const object = record(task);
    if (!object || statusValue(object.status) !== "failed") return false;
    const timestamp = normalizeTimestamp(firstValue(object, ["updated_at", "updatedAt", "created_at", "createdAt"]));
    return timestamp !== null && Date.now() - timestamp <= 86_400_000;
  }).length;
  const running = count(agents.active_jobs, count(workersObject.bridge_running ?? workersObject.running));
  const queued = count(agents.queued_jobs, count(queueObject.depth));
  const max = count(agents.max_jobs, count(workersObject.max, 5));
  const pending = Array.isArray(tasks.pending_confirmations)
    ? tasks.pending_confirmations.length
    : count(status.dashboard && record(status.dashboard)?.pending_confirmation_count);
  return {
    source: "normalized_status",
    updatedAt: scalarText(status.updated_at ?? status.updatedAt),
    bridge,
    tunnel: {
      ...tunnelStatus,
      state: registration.state === "ready" && tunnelStatus.state !== "error" ? "ready" : tunnelStatus.state,
      label: registration.state === "ready" && tunnelStatus.state !== "error" ? "已就绪" : tunnelStatus.label,
      registration: registration.state,
    },
    plugin,
    codex,
    activeNativeTurns: active,
    agentJobs: { running, queued, max, recentFailures },
    workers: {
      running: count(workersObject.running, running),
      nativeActive: count(workersObject.native_active),
      max,
    },
    queue: { depth: queued, pending },
  };
}

export function normalizeNativeThreadRecord(value: unknown, now = Date.now()): NativeThreadReadModel {
  const raw = record(value) ?? {};
  const nested = record(raw.thread) ?? raw;
  const id = scalarText(firstValue(nested, ["id", "thread_id"]) ?? firstValue(raw, ["id", "thread_id"])) ?? "";
  const title = scalarText(firstValue(nested, ["title", "name", "preview", "last_message"]) ?? firstValue(raw, ["title", "name", "preview"])) ?? "未命名会话";
  const status = scalarText(firstValue(nested, ["status", "state", "type"]) ?? firstValue(raw, ["status", "state", "type"])) ?? "idle";
  const cwd = scalarText(firstValue(nested, ["cwd", "working_directory", "workingDirectory"]) ?? firstValue(raw, ["cwd", "working_directory", "workingDirectory"]), ["path", "fullPath", "absolutePath", "value"]);
  const sourceValue = firstValue(nested, ["source", "threadSource", "created_by", "createdBy", "execution_source", "origin"]) ?? firstValue(raw, ["source", "threadSource", "created_by", "createdBy", "execution_source", "origin"]);
  const source = scalarText(sourceValue, ["type", "source", "name", "label", "value"]);
  const modelValue = firstValue(nested, ["model", "modelProvider", "model_provider"]) ?? firstValue(raw, ["model", "modelProvider", "model_provider"]);
  const model = scalarText(modelValue, ["id", "model", "name", "provider", "modelProvider", "value"]);
  const git = record(firstValue(nested, ["gitInfo", "git_info"]) ?? firstValue(raw, ["gitInfo", "git_info"]));
  const gitInfo = git ? scalarText(firstValue(git, ["branch", "branch_name", "repository", "root", "name"]), ["branch", "branch_name", "repository", "root", "name", "value"]) : null;
  const timestampValue = firstValue(nested, ["updatedAt", "updated_at", "recencyAt", "recency_at", "createdAt", "created_at"]) ?? firstValue(raw, ["updatedAt", "updated_at", "recencyAt", "recency_at", "createdAt", "created_at"]);
  const timestamp = normalizeTimestamp(timestampValue);
  const iso = timestamp === null ? null : new Date(timestamp).toISOString();
  return {
    id,
    title,
    status,
    cwd,
    source,
    model,
    gitInfo,
    updatedAt: iso,
    recencyAt: iso,
    recencyLabel: formatRelativeTimestamp(timestamp, now),
    displayCwd: shortenWindowsPath(cwd),
  };
}
