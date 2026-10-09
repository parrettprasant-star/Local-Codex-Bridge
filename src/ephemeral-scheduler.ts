import type { CodexAppServerAdapter } from "./app-server-adapter.js";
import { ModelGuard, type AllowedModelDecision } from "./model-guard.js";
import { ResultService } from "./result-service.js";
import { TaskManager, type TaskRecord } from "./task-manager.js";
import type { TaskDefinition } from "./task-definition.js";
import { TaskRuntime } from "./task-runtime.js";
import { buildExecutionResult } from "./execution-result.js";
import {
  EphemeralCodexRunner,
  type CodexCapabilitySnapshot,
  type EphemeralCodexResult,
  type EphemeralPhaseTimings,
  type EphemeralRunnerEvent,
  type EphemeralTimingContext,
} from "./ephemeral-codex-runner.js";
import { MAX_LUNA_WORKERS, WorkerPool, type WorkerSlot } from "./worker-pool.js";
import { WriteClaimConflictError, WriteClaimRegistry } from "./write-claims.js";

export interface TaskSubmissionResult {
  accepted: true;
  deduplicated: boolean;
  task: TaskRecord;
  task_id: string;
  status: TaskRecord["status"];
}

export interface TaskActionRejected {
  accepted: false;
  task_id: string;
  status: "busy" | "RECOVERY_REQUIRED" | "FAILED";
  reason: string;
  task: TaskRecord;
}

export interface EphemeralActiveJob {
  taskId: string;
  workerId: string;
  jobId: string;
  claimId: string | null;
  decision: AllowedModelDecision;
  subagents_active: number;
  subagents_reported: boolean;
}

export interface EphemeralSchedulerSnapshot {
  max_workers: number;
  running_workers: number;
  queue_depth: number;
  waiting_task_ids: string[];
  active: EphemeralActiveJob[];
  workers: WorkerSlot[];
  native_subagents: {
    support: "available" | "degraded" | "not_reported";
    active: number;
    max: number;
    reported: boolean;
  };
}

export interface EphemeralTimingRecord extends EphemeralPhaseTimings {
  task_id: string;
  status: EphemeralCodexResult["status"];
}

export interface BridgeTaskScheduler {
  readonly store: TaskManager;
  readonly adapter: CodexAppServerAdapter;
  readonly modelGuard: ModelGuard;
  readonly pool: WorkerPool;
  readonly claims: WriteClaimRegistry;
  readonly resultService: ResultService;
  submit(definition: TaskDefinition): TaskSubmissionResult;
  continueTask(taskId: string, definition: TaskDefinition): Promise<TaskSubmissionResult | TaskActionRejected>;
  snapshot(): EphemeralSchedulerSnapshot | {
    max_workers: number;
    running_workers: number;
    queue_depth: number;
    waiting_task_ids: string[];
    workers: WorkerSlot[];
    [key: string]: unknown;
  };
  reconcile(): Promise<void>;
  close(): void;
  cancel?(taskId: string): boolean;
  cancelRequested?(taskId: string): boolean;
  taskInput?(taskId: string): string | null;
  capabilities?(): CodexCapabilitySnapshot | null;
  agentsStatus?(): Record<string, unknown>;
  timingHistory?(): EphemeralTimingRecord[];
}

interface PendingJob {
  definition: TaskDefinition;
  timing: EphemeralTimingContext;
}

interface ActiveJob extends EphemeralActiveJob {
  controller: AbortController;
  timing: EphemeralTimingContext;
}

const TERMINAL_STATUSES = new Set(["DONE", "COMPLETED", "FAILED", "INTERRUPTED", "BLOCKED"]);
const MAX_TASK_INPUT_PREVIEW = 8_000;

function boundedSummary(value: string, maximum = 500): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function eventProjection(event: EphemeralRunnerEvent): { stage: string; action: string; progress: number } | null {
  const type = event.type.toLowerCase();
  if (event.subagent) {
    return {
      stage: "native subagents",
      action: event.subagent.kind === "started" ? "正在启动子 Agent" : "子 Agent 已完成",
      progress: 45,
    };
  }
  if (type.includes("turn.completed")) return { stage: "finalizing", action: "正在生成结果", progress: 95 };
  if (type.includes("turn.started")) return { stage: "running", action: "正在分析", progress: 20 };
  if (type.includes("command") || type.includes("exec")) return { stage: "tool execution", action: event.text ?? "正在执行工具", progress: 35 };
  if (type.includes("file") || type.includes("patch")) return { stage: "file change", action: event.text ?? "正在处理文件", progress: 40 };
  if (type.includes("agent") || type.includes("message") || event.text) return { stage: "reasoning", action: event.text ?? "正在分析", progress: 60 };
  return null;
}

export class EphemeralTaskScheduler implements BridgeTaskScheduler {
  readonly store: TaskManager;
  readonly adapter: CodexAppServerAdapter;
  readonly modelGuard: ModelGuard;
  readonly pool: WorkerPool;
  readonly claims: WriteClaimRegistry;
  readonly resultService: ResultService;
  readonly #runner: EphemeralCodexRunner;
  readonly #pending = new Map<string, PendingJob>();
  readonly #queue: string[] = [];
  readonly #active = new Map<string, ActiveJob>();
  readonly #taskInputs = new Map<string, string>();
  readonly #cancelRequested = new Set<string>();
  readonly #timings: EphemeralTimingRecord[] = [];
  #pumping = false;
  #closed = false;

  constructor(
    store: TaskManager,
    adapter: CodexAppServerAdapter,
    modelGuard: ModelGuard,
    _runtime: TaskRuntime,
    runner = new EphemeralCodexRunner(),
  ) {
    this.store = store;
    this.adapter = adapter;
    this.modelGuard = modelGuard;
    this.pool = new WorkerPool(MAX_LUNA_WORKERS, "codex-exec-ephemeral");
    this.claims = new WriteClaimRegistry();
    this.resultService = new ResultService(store);
    this.#runner = runner;
  }

  capabilities(): CodexCapabilitySnapshot | null {
    return this.#runner.capabilities();
  }

  async reconcile(): Promise<void> {
    try {
      await this.#runner.detectCapabilities();
    } catch {
      // A task receives the concrete runner error; the UI remains explicitly unreported.
    }
    const ownedTaskIds = new Set<string>([
      ...this.#pending.keys(),
      ...this.#active.keys(),
      ...this.pool.snapshot()
        .filter((worker) => worker.task_id !== null && worker.status !== "IDLE")
        .map((worker) => worker.task_id as string),
    ]);
    for (const task of this.store.unfinished().filter((candidate) => candidate.execution_source === "bridge")) {
      // A persisted worker id is only evidence when this scheduler can also
      // prove the live in-memory worker/runner context. After process loss the
      // maps and pool are empty, so the task must fail closed.
      if (ownedTaskIds.has(task.id)) continue;
      if (task.status === "RECOVERY_REQUIRED") {
        this.#safeUpdate(task.id, {
          status: "INTERRUPTED",
          progress: 0,
          stage: "已中断",
          current_action: "任务已中断",
          next_action: "无",
          completed_at: task.completed_at ?? new Date().toISOString(),
          worker_id: null,
          thread_id: null,
          turn_id: null,
          last_error: task.last_error ?? "任务无法从上一次 Bridge 进程恢复",
          active: false,
        });
        continue;
      }
      this.#safeUpdate(task.id, {
        status: "RECOVERY_REQUIRED",
        progress: 0,
        stage: "需要处理",
        current_action: "任务无法自动恢复",
        next_action: "结束任务或重新提交",
        worker_id: null,
        thread_id: null,
        turn_id: null,
        last_error: "Ephemeral Bridge tasks are not resumable after process loss; submit a new task",
        active: false,
      });
    }
  }

  submit(definition: TaskDefinition): TaskSubmissionResult {
    const existing = this.store.findByFingerprint(definition.fingerprint);
    if (existing) {
      return { accepted: true, deduplicated: true, task: existing, task_id: existing.id, status: existing.status };
    }
    const submittedAt = new Date().toISOString();
    const task = this.store.create({
      name: definition.title ?? definition.name,
      type: "ephemeral-codex",
      execution_source: "bridge",
      status: "WAITING",
      stage: "queued",
      current_action: "正在排队等待 Worker",
      next_action: "正在启动 Codex",
      fingerprint: definition.fingerprint,
      cwd: definition.cwd,
      write_claims: definition.write_roots,
      result_manifest: {
        required_outputs: [...(definition.required_outputs ?? [])],
      },
      thread_id: null,
      turn_id: null,
      final_answer: "",
      active: true,
    });
    this.#taskInputs.set(task.id, definition.text.slice(0, MAX_TASK_INPUT_PREVIEW));
    this.#pending.set(task.id, {
      definition,
      timing: {
        submitted_at: submittedAt,
        task_created_at: task.created_at,
        queue_entered_at: new Date().toISOString(),
      },
    });
    this.#queue.push(task.id);
    void this.#pump();
    return { accepted: true, deduplicated: false, task, task_id: task.id, status: task.status };
  }

  async continueTask(taskId: string, _definition: TaskDefinition): Promise<TaskActionRejected> {
    const task = this.store.get(taskId);
    return {
      accepted: false,
      task_id: taskId,
      status: "RECOVERY_REQUIRED",
      reason: "ephemeral Bridge tasks cannot be resumed; submit a new task",
      task,
    };
  }

  cancel(taskId: string): boolean {
    const pending = this.#pending.get(taskId);
    const active = this.#active.get(taskId);
    if (!pending && !active) return false;
    if (this.#cancelRequested.has(taskId)) return true;
    this.#cancelRequested.add(taskId);
    if (pending && !active) {
      this.#pending.delete(taskId);
      const index = this.#queue.indexOf(taskId);
      if (index >= 0) this.#queue.splice(index, 1);
      this.#safeUpdate(taskId, {
        status: "INTERRUPTED",
        completed_at: new Date().toISOString(),
        worker_id: null,
        thread_id: null,
        turn_id: null,
        last_error: "任务已取消",
      });
      this.#cancelRequested.delete(taskId);
      void this.#pump();
      return true;
    }
    // Abort only the exact AGENTS child owned by this task. No process-name or
    // process-tree kill is issued by the control surface.
    active?.controller.abort();
    return true;
  }

  cancelRequested(taskId: string): boolean {
    return this.#cancelRequested.has(taskId);
  }

  taskInput(taskId: string): string | null {
    return this.#taskInputs.get(taskId) ?? null;
  }

  snapshot(): EphemeralSchedulerSnapshot {
    const active = [...this.#active.values()].map((job) => ({
      taskId: job.taskId,
      workerId: job.workerId,
      jobId: job.jobId,
      claimId: job.claimId,
      decision: { ...job.decision },
      subagents_active: job.subagents_active,
      subagents_reported: job.subagents_reported,
    }));
    const reported = active.some((job) => job.subagents_reported);
    const support = this.#runner.capabilities()?.native_subagents;
    return {
      max_workers: this.pool.maxWorkers,
      running_workers: this.pool.runningCount(),
      queue_depth: this.#queue.length,
      waiting_task_ids: [...this.#queue],
      active,
      workers: this.pool.snapshot(),
      native_subagents: {
        support: reported ? (support === "degraded" ? "degraded" : "available") : "not_reported",
        active: active.reduce((sum, job) => sum + job.subagents_active, 0),
        max: this.pool.maxWorkers,
        reported,
      },
    };
  }

  agentsStatus(): Record<string, unknown> {
    const capabilities = this.#runner.capabilities();
    const snapshot = this.snapshot();
    return {
      name: "AGENTS",
      technical_name: "Ephemeral Codex",
      owner: "bridge-task-runner",
      status: "ready",
      execution: "codex exec --ephemeral --json",
      persistent_threads: false,
      transcript_store: "bridge-task-history-only",
      max_jobs: this.pool.maxWorkers,
      active_jobs: snapshot.running_workers,
      queued_jobs: snapshot.queue_depth,
      native_subagents: capabilities?.native_subagents ?? "not_reported",
      subagent_active: snapshot.native_subagents.active,
      subagent_reported: snapshot.native_subagents.reported,
      capabilities,
    };
  }

  timingHistory(): EphemeralTimingRecord[] {
    return this.#timings.map((timing) => ({ ...timing }));
  }

  close(): void {
    this.#closed = true;
    for (const job of this.#active.values()) job.controller.abort();
    this.#pending.clear();
    this.#queue.length = 0;
    this.#cancelRequested.clear();
    this.#taskInputs.clear();
  }

  async #pump(): Promise<void> {
    if (this.#pumping || this.#closed) return;
    this.#pumping = true;
    try {
      while (this.#queue.length > 0 && this.pool.runningCount() < this.pool.maxWorkers && !this.#closed) {
        const taskId = this.#queue.shift()!;
        const pending = this.#pending.get(taskId);
        if (!pending) continue;
        const task = this.store.get(taskId);
        if (TERMINAL_STATUSES.has(task.status)) {
          this.#pending.delete(taskId);
          continue;
        }
        const slot = this.pool.acquire(taskId);
        if (!slot) {
          this.#queue.unshift(taskId);
          break;
        }
        void this.#start(taskId, slot.worker_id, pending, new Date().toISOString()).catch((error: unknown) => this.#failStart(taskId, slot.worker_id, error));
      }
    } finally {
      this.#pumping = false;
    }
  }

  async #start(taskId: string, workerId: string, pending: PendingJob, workerAcquiredAt: string): Promise<void> {
    const task = this.store.get(taskId);
    const timing: EphemeralTimingContext = {
      ...pending.timing,
      worker_acquired_at: workerAcquiredAt,
      dispatch_at: new Date().toISOString(),
    };
    const claimId = pending.definition.write_roots.length > 0 ? `claim:${taskId}` : null;
    if (claimId) {
      try {
        this.claims.claim(taskId, pending.definition.write_roots, claimId);
      } catch (error) {
        if (error instanceof WriteClaimConflictError) {
          this.#safeUpdate(taskId, { status: "BLOCKED", worker_id: null, last_error: error.message });
          this.pool.release(workerId);
          this.#pending.delete(taskId);
          return;
        }
        throw error;
      }
    }
    this.#safeUpdate(taskId, {
      status: "STARTING",
      worker_id: workerId,
      thread_id: null,
      turn_id: null,
      started_at: task.started_at ?? new Date().toISOString(),
      last_error: null,
      stage: "starting",
      current_action: "正在启动 Codex",
      next_action: "等待 Codex 首个 JSON 事件",
      progress: 0,
    });
    if (!this.modelGuard.isReady()) {
      const models = await this.adapter.modelList();
      this.modelGuard.configureCatalog(models);
    }
    const decision = this.modelGuard.evaluate({
      ...(pending.definition.requested_model ? { requested_model: pending.definition.requested_model } : {}),
      ...(pending.definition.requested_effort ? { requested_effort: pending.definition.requested_effort } : {}),
      task_policy: {
        ...(pending.definition.task_type ? { task_type: pending.definition.task_type } : {}),
        complexity: pending.definition.task_complexity ?? "normal",
      },
    });
    if (!decision.allowed) {
      this.#safeUpdate(taskId, { status: "BLOCKED", worker_id: null, last_error: decision.reason });
      this.#release(taskId, workerId, claimId);
      return;
    }
    this.pool.update(workerId, {
      phase: "exec/start",
      runtime: "codex-exec-ephemeral",
      policy_model: decision.model,
      policy_effort: decision.effort,
      requested_model: decision.selection_mode === "manual" ? decision.model : null,
      requested_effort: decision.effort,
      write_claim: claimId,
      retry_count: task.retry_count,
      thread_id: null,
      turn_id: null,
    });
    const controller = new AbortController();
    const job: ActiveJob = {
      taskId,
      workerId,
      jobId: `job:${taskId}`,
      claimId,
      decision,
      controller,
      timing,
      subagents_active: 0,
      subagents_reported: false,
    };
    this.#active.set(taskId, job);
    this.#safeUpdate(taskId, {
      status: "RUNNING",
      stage: "starting",
      current_action: "正在建立会话",
      next_action: "等待 Codex 首个 JSON 事件",
      progress: 0,
    });
    this.modelGuard.markAccepted(decision);
    try {
      const result = await this.#runner.run({
        cwd: pending.definition.cwd,
        prompt: pending.definition.text,
        model: decision.model,
        effort: decision.effort,
        sandbox: pending.definition.sandbox,
        approval_policy: pending.definition.approval_policy ?? "on-request",
        max_subagents: MAX_LUNA_WORKERS,
        max_subagent_depth: 1,
        job_max_runtime_seconds: 86_400,
        timing_context: timing,
        signal: controller.signal,
        onEvent: (event) => this.#projectEvent(job, event),
      });
      this.#finish(taskId, workerId, claimId, result);
    } catch (error) {
      this.#finish(taskId, workerId, claimId, {
        status: controller.signal.aborted ? "interrupted" : "failed",
        final_answer: "",
        exit_code: null,
        signal: null,
        stderr: error instanceof Error ? error.message : String(error),
        events: [],
        timings: {
          started_at: task.started_at ?? new Date().toISOString(),
          first_event_at: null,
          first_answer_at: null,
          completed_at: new Date().toISOString(),
          startup_ms: null,
          time_to_first_event_ms: null,
          time_to_first_answer_ms: null,
          total_ms: 0,
        },
        subagents: {
          support: "degraded",
          reported: false,
          active: 0,
          max_concurrent: MAX_LUNA_WORKERS,
          started: 0,
          stopped: 0,
        },
      });
    }
  }

  #projectEvent(job: ActiveJob, event: EphemeralRunnerEvent): void {
    const projection = eventProjection(event);
    if (event.subagent) {
      job.subagents_reported = true;
      job.subagents_active = event.subagent.kind === "started"
        ? job.subagents_active + 1
        : Math.max(0, job.subagents_active - 1);
      this.pool.update(job.workerId, { phase: "native-subagents", error: null });
    }
    if (!projection) return;
    const task = this.store.get(job.taskId);
    const key = `${projection.stage}\0${projection.action}\0${projection.progress}`;
    if (`${task.stage}\0${task.current_action}\0${task.progress}` === key) return;
    this.#safeUpdate(job.taskId, {
      stage: projection.stage,
      current_action: projection.action,
      progress: Math.max(task.progress, projection.progress),
    });
  }

  #finish(taskId: string, workerId: string, claimId: string | null, result: EphemeralCodexResult): void {
    const task = this.store.get(taskId);
    const completed = result.status === "completed";
    const requestedCancellation = this.#cancelRequested.delete(taskId);
    const interrupted = result.status === "interrupted" || (requestedCancellation && !completed);
    const message = result.status === "failed"
      ? result.stderr || `codex exec exited with code ${String(result.exit_code)}`
      : null;
    const error = interrupted && requestedCancellation ? "任务已取消" : message;
    const timing = result.timings.phase_timings;
    const completionTask = {
      ...task,
      status: completed ? "COMPLETED" : interrupted ? "INTERRUPTED" : "FAILED",
    } as TaskRecord;
    const executionResult = buildExecutionResult(completionTask, {
      process_started: timing?.process_created_at !== null && timing?.process_created_at !== undefined,
      process_exit_code: result.exit_code,
      command_success: completed,
      ...(error && /CreateProcessAsUserW\s+failed:\s*267|error\s*267|invalid directory/i.test(error)
        ? { error_code: "win32_create_process_invalid_directory_267" }
        : {}),
    });
    if (timing) {
      this.#timings.push({ task_id: taskId, status: result.status, ...timing });
      if (this.#timings.length > 20) this.#timings.splice(0, this.#timings.length - 20);
    }
    this.#safeUpdate(taskId, {
      status: completed ? "COMPLETED" : interrupted ? "INTERRUPTED" : "FAILED",
      progress: completed ? 100 : task.progress,
      stage: completed ? "completed" : interrupted ? "interrupted" : "failed",
      current_action: completed ? "最终结果已生成" : interrupted ? "Ephemeral 执行已取消" : "Ephemeral 执行失败",
      next_action: completed ? "review Bridge task history" : "inspect error and submit a new task",
      completed_at: result.timings.completed_at,
      worker_id: null,
      thread_id: null,
      turn_id: null,
      final_answer: result.final_answer,
      result_summary: boundedSummary(result.final_answer || (completed ? "Ephemeral Codex completed" : error ?? "Ephemeral Codex failed")),
      last_error: error,
      result_manifest: {
        ...task.result_manifest,
        integrity: executionResult.output_manifest,
        execution_result: executionResult,
      },
      active: false,
    });
    try {
      this.resultService.finalize(taskId);
    } catch {
      // Result integrity is a separate read-only concern; task completion remains recorded.
    }
    this.#release(taskId, workerId, claimId);
    this.#pending.delete(taskId);
    void this.#pump();
  }

  #failStart(taskId: string, workerId: string, error: unknown): void {
    const pending = this.#pending.get(taskId);
    const message = error instanceof Error ? error.message : String(error);
    this.#safeUpdate(taskId, {
      status: "FAILED",
      completed_at: new Date().toISOString(),
      worker_id: null,
      thread_id: null,
      turn_id: null,
      last_error: message,
      result_summary: boundedSummary(message),
      active: false,
    });
    this.#release(taskId, workerId, pending && pending.definition.write_roots.length > 0 ? `claim:${taskId}` : null);
    this.#pending.delete(taskId);
    void this.#pump();
  }

  #release(taskId: string, workerId: string, claimId: string | null): void {
    if (claimId) this.claims.release(claimId);
    this.#active.delete(taskId);
    this.pool.release(workerId);
  }

  #safeUpdate(taskId: string, patch: Record<string, unknown>): TaskRecord | null {
    try {
      return this.store.update(taskId, patch);
    } catch {
      return null;
    }
  }
}
