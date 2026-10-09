import type { CodexAppServerAdapter } from "./app-server-adapter.js";
import { isGeneratedNativeTaskTitle, resolveReadableTaskTitle } from "./readable-task-title.js";
import type { RuntimeObservation, RuntimeStore, RuntimeTaskLifecycleSignal } from "./runtime.js";
import { TaskManager, type TaskRecord, type TaskLifecycle } from "./task-manager.js";
import { ResultService } from "./result-service.js";

const DEFAULT_MIN_INTERVAL_MS = 30_000;
const NATIVE_UNFINISHED_STATUSES = new Set<TaskLifecycle>([
  "WAITING",
  "STARTING",
  "RUNNING",
  "RETRYING",
  "RECOVERY_REQUIRED",
  "PAUSED",
  "NEED_CONFIRM",
]);

type NativeTerminalStatus = "COMPLETED" | "INTERRUPTED" | "FAILED";

interface NativePersistentEvidence {
  terminal: NativeTerminalStatus | null;
  activeTurnId: string | null;
  pendingCount: number | null;
  turnStatus: string | null;
}

export interface NativeReconciliationSummary {
  inspected: number;
  corrected: number;
  mapping_recovered: number;
  kept_live: number;
  kept_pending: number;
  no_terminal_evidence: number;
  errors: number;
  title_updates: number;
  at: string;
}

export interface NativeStateReconcilerOptions {
  minIntervalMs?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function statusValue(value: unknown): string | null {
  if (typeof value === "string") return value.toLowerCase();
  if (!isRecord(value)) return null;
  return stringValue(value.type)?.toLowerCase() ?? stringValue(value.status)?.toLowerCase() ?? null;
}

function terminalStatus(value: string | null): NativeTerminalStatus | null {
  switch (value) {
    case "complete":
    case "completed":
    case "success":
    case "succeeded":
    case "done":
      return "COMPLETED";
    case "interrupted":
    case "cancelled":
    case "canceled":
      return "INTERRUPTED";
    case "failed":
    case "error":
      return "FAILED";
    default:
      return null;
  }
}

function arrayField(...values: unknown[]): unknown[] | null {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return null;
}

function activeTurnId(root: Record<string, unknown>, thread: Record<string, unknown>): string | null {
  return (
    stringValue(root.active_turn_id) ??
    stringValue(root.activeTurnId) ??
    stringValue(thread.active_turn_id) ??
    stringValue(thread.activeTurnId)
  );
}

function pendingCount(root: Record<string, unknown>, thread: Record<string, unknown>): number | null {
  const pending = arrayField(
    root.pending_requests,
    root.pendingRequests,
    thread.pending_requests,
    thread.pendingRequests,
  );
  return pending === null ? null : pending.length;
}

function readPersistentEvidence(
  result: Record<string, unknown>,
  expectedTurnId: string,
): NativePersistentEvidence {
  const thread = recordValue(result.thread) ?? {};
  const turns = arrayField(thread.turns, result.turns) ?? [];
  const targetTurn = turns
    .map((candidate) => recordValue(candidate))
    .find((candidate) => candidate?.id === expectedTurnId) ??
    (recordValue(result.turn)?.id === expectedTurnId ? recordValue(result.turn) : null);
  const turnStatus = statusValue(targetTurn?.status ?? targetTurn?.state);
  const directStatus = statusValue(thread.status ?? result.status);
  return {
    terminal: terminalStatus(turnStatus) ?? (targetTurn ? terminalStatus(directStatus) : null),
    activeTurnId: activeTurnId(result, thread),
    pendingCount: pendingCount(result, thread),
    turnStatus: turnStatus ?? directStatus,
  };
}

function liveObservation(runtime: RuntimeStore, threadId: string): RuntimeObservation | null {
  try {
    return runtime.observe(threadId, undefined, 1);
  } catch {
    return null;
  }
}

function hasLiveActivity(observation: RuntimeObservation | null): boolean {
  return observation?.active_turn_id !== null && observation?.active_turn_id !== undefined;
}

function hasPendingRequests(observation: RuntimeObservation | null): boolean {
  return Array.isArray(observation?.pending_requests) && observation.pending_requests.length > 0;
}

function nativeMappingFromFingerprint(task: TaskRecord): { threadId: string; turnId: string } | null {
  if (task.execution_source !== "external/native" || !task.fingerprint.startsWith("runtime:")) {
    return null;
  }
  const encoded = task.fingerprint.slice("runtime:".length);
  const separator = encoded.lastIndexOf(":");
  if (separator <= 0 || separator === encoded.length - 1) return null;
  const threadId = encoded.slice(0, separator);
  const turnId = encoded.slice(separator + 1);
  return threadId.length > 0 && turnId.length > 0 ? { threadId, turnId } : null;
}

function terminalPatch(task: TaskRecord, status: NativeTerminalStatus, now: string): Record<string, unknown> {
  if (status === "COMPLETED") {
    return {
      status,
      progress: 100,
      stage: "已完成",
      current_action: "Codex 回合已完成",
      next_action: "无",
      completed_at: task.completed_at ?? now,
      last_error: null,
      result_summary: task.result_summary || "Codex 回合已完成",
    };
  }
  if (status === "INTERRUPTED") {
    return {
      status,
      stage: "已中断",
      current_action: "Codex 回合已中断",
      next_action: "无",
      completed_at: task.completed_at ?? now,
      last_error: "authoritative native turn status: interrupted",
    };
  }
  return {
    status,
    stage: "执行失败",
    current_action: "Codex 回合失败",
    next_action: "检查错误后决定是否重试",
    completed_at: task.completed_at ?? now,
    last_error: "authoritative native turn status: failed",
  };
}

export class NativeStateReconciler {
  readonly #manager: TaskManager;
  readonly #resultService: ResultService;
  readonly #adapter: CodexAppServerAdapter;
  readonly #runtime: RuntimeStore;
  readonly #minIntervalMs: number;
  readonly #now: () => Date;
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #unsubscribe: () => void;
  #lastRunAt = 0;
  #lastSummary: NativeReconciliationSummary | null = null;
  #inFlight: Promise<NativeReconciliationSummary> | null = null;
  readonly #titleSettled = new Set<string>();

  constructor(
    manager: TaskManager,
    adapter: CodexAppServerAdapter,
    runtime: RuntimeStore,
    options: NativeStateReconcilerOptions = {},
  ) {
    this.#manager = manager;
    this.#resultService = new ResultService(manager);
    this.#adapter = adapter;
    this.#runtime = runtime;
    this.#minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    if (!Number.isInteger(this.#minIntervalMs) || this.#minIntervalMs < 0) {
      throw new Error("native reconciliation interval must be a non-negative integer");
    }
    this.#now = options.now ?? (() => new Date());
    this.#onError = options.onError;
    this.#unsubscribe = runtime.onTaskLifecycle((signal) => this.#handleLifecycle(signal));
  }

  close(): void {
    this.#unsubscribe();
  }

  async reconcile(): Promise<NativeReconciliationSummary> {
    return await this.#startReconciliation(true);
  }

  async ensureReconciled(): Promise<NativeReconciliationSummary> {
    const now = Date.now();
    if (this.#lastSummary && now - this.#lastRunAt < this.#minIntervalMs) {
      return { ...this.#lastSummary };
    }
    return await this.#startReconciliation(false);
  }

  #handleLifecycle(signal: RuntimeTaskLifecycleSignal): void {
    if (signal.kind !== "turn_completed") return;
    const task = this.#findNativeTask(signal.thread_id, signal.turn_id);
    if (!task || task.execution_source !== "external/native") return;
    this.#titleSettled.delete(task.id);
    void this.#startReconciliation(true).catch((error: unknown) => this.#report(error));
  }

  async #startReconciliation(force: boolean): Promise<NativeReconciliationSummary> {
    if (this.#inFlight) return await this.#inFlight;
    if (!force && this.#lastSummary && Date.now() - this.#lastRunAt < this.#minIntervalMs) {
      return { ...this.#lastSummary };
    }
    this.#inFlight = this.#run();
    try {
      const summary = await this.#inFlight;
      this.#lastSummary = summary;
      this.#lastRunAt = Date.now();
      return { ...summary };
    } finally {
      this.#inFlight = null;
    }
  }

  async #run(): Promise<NativeReconciliationSummary> {
    const at = this.#now().toISOString();
    const summary: NativeReconciliationSummary = {
      inspected: 0,
      corrected: 0,
      mapping_recovered: 0,
      kept_live: 0,
      kept_pending: 0,
      no_terminal_evidence: 0,
      errors: 0,
      title_updates: 0,
      at,
    };
    const storedExternal = this.#manager
      .snapshot()
      .tasks
      .filter((task) => task.execution_source === "external/native");
    for (const task of storedExternal) this.#recoverMapping(task, summary);

    const unfinished = this.#manager
      .unfinished()
      .filter((task) => task.execution_source === "external/native" && NATIVE_UNFINISHED_STATUSES.has(task.status));
    const titleRepairs = this.#manager
      .snapshot()
      .tasks
      .filter((task) =>
        task.execution_source === "external/native" &&
        isGeneratedNativeTaskTitle(task.name) &&
        !this.#titleSettled.has(task.id) &&
        task.thread_id !== null &&
        task.turn_id !== null,
      )
      .slice(0, 50);
    const tasksById = new Map<string, TaskRecord>();
    for (const task of [...unfinished, ...titleRepairs]) tasksById.set(task.id, task);
    const tasks = [...tasksById.values()];
    for (const task of tasks) {
      summary.inspected += 1;
      try {
        const changed = NATIVE_UNFINISHED_STATUSES.has(task.status)
          ? await this.#reconcileTask(task, at, summary)
          : await this.#repairTitle(task, summary);
        if (changed) summary.corrected += 1;
      } catch (error) {
        summary.errors += 1;
        this.#report(error);
      }
    }
    return summary;
  }

  async #reconcileTask(task: TaskRecord, at: string, summary: NativeReconciliationSummary): Promise<boolean> {
    if (!task.thread_id || !task.turn_id) {
      summary.no_terminal_evidence += 1;
      return false;
    }
    const live = liveObservation(this.#runtime, task.thread_id);
    if (hasLiveActivity(live)) {
      summary.kept_live += 1;
      if (hasPendingRequests(live)) {
        return this.#keepConfirmation(task);
      }
      return this.#keepRunning(task);
    }
    if (hasPendingRequests(live)) {
      summary.kept_pending += 1;
      return this.#keepConfirmation(task);
    }

    const result = await this.#adapter.threadRead(task.thread_id, true);
    const titleChanged = this.#updateTitle(task, result, summary);
    const evidence = readPersistentEvidence(result, task.turn_id);
    if (evidence.activeTurnId) {
      summary.kept_live += 1;
      return titleChanged || this.#keepRunning(task);
    }
    if (evidence.pendingCount !== null && evidence.pendingCount > 0) {
      summary.kept_pending += 1;
      return titleChanged || this.#keepConfirmation(task);
    }
    if (!evidence.terminal) {
      summary.no_terminal_evidence += 1;
      return titleChanged;
    }
    this.#manager.update(task.id, terminalPatch(task, evidence.terminal, at));
    if (task.result_manifest.required_outputs.length > 0) {
      try { this.#resultService.finalize(task.id); } catch { }
    }
    return true;
  }

  async #repairTitle(task: TaskRecord, summary: NativeReconciliationSummary): Promise<boolean> {
    if (!task.thread_id || !task.turn_id) return false;
    const result = await this.#adapter.threadRead(task.thread_id, true);
    return this.#updateTitle(task, result, summary);
  }

  #updateTitle(task: TaskRecord, threadReadResult: unknown, summary: NativeReconciliationSummary): boolean {
    const resolution = resolveReadableTaskTitle(task, threadReadResult);
    if (resolution.source === "fallback") this.#titleSettled.add(task.id);
    if (!resolution.title || resolution.title === task.name) return false;
    this.#manager.update(task.id, { name: resolution.title });
    summary.title_updates += 1;
    return true;
  }

  #findNativeTask(threadId: string, turnId: string): TaskRecord | null {
    const exact = this.#manager.findByThreadTurn(threadId, turnId);
    if (exact?.execution_source === "external/native") return exact;
    const fingerprint = `runtime:${threadId}:${turnId}`;
    return this.#manager
      .snapshot()
      .tasks
      .find((task) => task.execution_source === "external/native" && task.fingerprint === fingerprint) ?? null;
  }

  #recoverMapping(task: TaskRecord, summary: NativeReconciliationSummary): TaskRecord {
    const mapping = nativeMappingFromFingerprint(task);
    if (!mapping) return task;
    if (task.thread_id !== null && task.thread_id !== mapping.threadId) return task;
    if (task.turn_id !== null && task.turn_id !== mapping.turnId) return task;
    if (task.thread_id === mapping.threadId && task.turn_id === mapping.turnId) return task;
    const recovered = this.#manager.update(task.id, {
      thread_id: task.thread_id ?? mapping.threadId,
      turn_id: task.turn_id ?? mapping.turnId,
    });
    summary.mapping_recovered += 1;
    return recovered;
  }

  #keepConfirmation(task: TaskRecord): boolean {
    if (task.status === "NEED_CONFIRM" && task.last_error === null) return false;
    this.#manager.update(task.id, {
      status: "NEED_CONFIRM",
      stage: "等待确认",
      current_action: "等待审批或用户输入",
      next_action: "确认后继续执行",
      last_error: null,
    });
    return true;
  }

  #keepRunning(task: TaskRecord): boolean {
    if (task.status === "RUNNING" && task.last_error === null) return false;
    this.#manager.update(task.id, {
      status: "RUNNING",
      stage: "Codex 执行中",
      current_action: "原生 Codex 回合执行中",
      next_action: "等待执行结果",
      last_error: null,
    });
    return true;
  }

  #report(error: unknown): void {
    try {
      this.#onError?.(error);
    } catch {
      // Reconciliation diagnostics must not affect the status/API path.
    }
  }
}
