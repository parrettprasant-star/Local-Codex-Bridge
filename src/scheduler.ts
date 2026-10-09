import type { RuntimeStore, RuntimeTaskLifecycleSignal } from "./runtime.js";
import { isThreadResumeBusyError } from "./app-server.js";
import {
  CodexAppServerAdapter,
  isServerOverloaded,
  type AppServerThreadResult,
} from "./app-server-adapter.js";
import { exponentialBackoffMs } from "./backoff.js";
import { ModelGuard, type AllowedModelDecision } from "./model-guard.js";
import { ResultService } from "./result-service.js";
import { buildExecutionResult } from "./execution-result.js";
import { defaultResultIntegrity } from "./result-manifest.js";
import { TaskManager, type TaskRecord } from "./task-manager.js";
import type { TaskDefinition } from "./task-definition.js";
import { ServiceSessionManager, type ServiceSessionPlan } from "./service-session.js";
import { WriteClaimConflictError, WriteClaimRegistry } from "./write-claims.js";
import { MAX_LUNA_WORKERS, WorkerPool, type WorkerSlot } from "./worker-pool.js";

const MAX_RETRIES = 3;

interface PendingTask {
  definition: TaskDefinition;
  retryTimer?: NodeJS.Timeout;
}

interface ActiveTask {
  taskId: string;
  workerId: string;
  claimId: string | null;
  decision: AllowedModelDecision;
  threadId: string;
  turnId: string;
  serviceSessionId: string | null;
}

export interface SchedulerOptions {
  maxRetries?: number;
  random?: () => number;
  onError?: (error: unknown) => void;
  serviceSessions?: ServiceSessionManager;
}

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

export class Scheduler {
  readonly store: TaskManager;
  readonly adapter: CodexAppServerAdapter;
  readonly modelGuard: ModelGuard;
  readonly pool: WorkerPool;
  readonly claims: WriteClaimRegistry;
  readonly resultService: ResultService;
  readonly serviceSessions: ServiceSessionManager;
  readonly #runtime: RuntimeStore;
  readonly #maxRetries: number;
  readonly #random: () => number;
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #pending = new Map<string, PendingTask>();
  readonly #continuationChecks = new Set<string>();
  readonly #queue: string[] = [];
  readonly #active = new Map<string, ActiveTask>();
  readonly #unsubscribe: () => void;
  #pumping = false;

  constructor(
    store: TaskManager,
    adapter: CodexAppServerAdapter,
    modelGuard: ModelGuard,
    runtime: RuntimeStore,
    options: SchedulerOptions = {},
  ) {
    this.store = store;
    this.adapter = adapter;
    this.modelGuard = modelGuard;
    this.pool = new WorkerPool(MAX_LUNA_WORKERS);
    this.claims = new WriteClaimRegistry();
    this.resultService = new ResultService(store);
    this.serviceSessions = options.serviceSessions ?? new ServiceSessionManager();
    this.#runtime = runtime;
    this.#maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.#random = options.random ?? Math.random;
    this.#onError = options.onError;
    this.#unsubscribe = runtime.onTaskLifecycle((signal) => this.#handleLifecycle(signal));
  }

  close(): void {
    this.#unsubscribe();
    for (const pending of this.#pending.values()) {
      if (pending.retryTimer) clearTimeout(pending.retryTimer);
    }
    this.#pending.clear();
    this.#continuationChecks.clear();
    this.#queue.length = 0;
  }

  async reconcile(): Promise<void> {
    const unfinished = this.store
      .unfinished()
      .filter((task) => task.execution_source === "bridge");
    try {
      const models = await this.adapter.modelList();
      this.modelGuard.configureCatalog(models);
    } catch (error) {
      for (const task of unfinished) {
        this.#safeUpdate(task.id, {
          status: "RECOVERY_REQUIRED",
          last_error: "Unable to query authoritative App Server model state",
        });
      }
      this.#report(error);
      return;
    }
    if (unfinished.length === 0) return;
    for (const task of unfinished) {
      await this.#reconcileTask(task);
    }
    void this.#pump();
  }

  submit(definition: TaskDefinition): TaskSubmissionResult {
    const existing = this.store.findByFingerprint(definition.fingerprint);
    if (existing) {
      return {
        accepted: true,
        deduplicated: true,
        task: existing,
        task_id: existing.id,
        status: existing.status,
      };
    }
    const task = this.store.create({
      name: definition.title ?? definition.name,
      type: "Codex 原生任务",
      execution_source: "bridge",
      status: "WAITING",
      stage: "排队等待",
      current_action: "等待 Luna worker",
      next_action: "由 Scheduler 分配 worker",
      fingerprint: definition.fingerprint,
      cwd: definition.cwd,
      write_claims: definition.write_roots,
      result_manifest: {
        required_outputs: [...(definition.required_outputs ?? [])],
      },
      active: true,
    });
    this.#pending.set(task.id, { definition });
    this.#queue.push(task.id);
    void this.#pump();
    return { accepted: true, deduplicated: false, task, task_id: task.id, status: task.status };
  }

  async continueTask(taskId: string, definition: TaskDefinition): Promise<TaskSubmissionResult | TaskActionRejected> {
    const task = this.store.get(taskId);
    if (!task.thread_id) {
      return { accepted: false, task_id: taskId, status: "RECOVERY_REQUIRED", reason: "task has no durable thread mapping", task };
    }
    if (
      this.#active.has(taskId) ||
      this.#pending.has(taskId) ||
      this.#continuationChecks.has(taskId) ||
      ["STARTING", "RUNNING", "RETRYING"].includes(task.status)
    ) {
      return { accepted: false, task_id: taskId, status: "busy", reason: "task thread is active", task };
    }
    this.#continuationChecks.add(taskId);
    try {
      try {
        const authoritative = await this.adapter.threadRead(task.thread_id, true);
        const thread = authoritative.thread as Record<string, unknown> | undefined;
        const turns = thread && Array.isArray(thread.turns) ? thread.turns : [];
        const active = turns.some((candidate) => {
          const status = typeof (candidate as Record<string, unknown>)?.status === "string"
            ? String((candidate as Record<string, unknown>)?.status).toLowerCase()
            : "";
          return ["inprogress", "running", "in_progress"].includes(status);
        });
        if (active) {
          return { accepted: false, task_id: taskId, status: "busy", reason: "authoritative thread is active", task };
        }
      } catch (error) {
        this.#safeUpdate(taskId, { status: "RECOVERY_REQUIRED", last_error: error instanceof Error ? error.message : String(error) });
        return { accepted: false, task_id: taskId, status: "RECOVERY_REQUIRED", reason: "unable to verify authoritative thread", task: this.store.get(taskId) };
      }
      const updated = this.store.update(taskId, {
        status: "WAITING",
        stage: "排队等待",
        current_action: "等待 Luna worker",
        next_action: "继续原 Codex Session",
        worker_id: null,
        turn_id: null,
        started_at: null,
        completed_at: null,
        last_error: null,
        result_summary: "",
        result_manifest: {
          ...task.result_manifest,
          review_status: "NOT_READY",
          required_outputs: [...(definition.required_outputs ?? [])],
          integrity: defaultResultIntegrity(),
          warnings: [],
        },
        active: true,
        name: definition.title ?? definition.name,
      });
      this.#pending.set(taskId, { definition: { ...definition, existing_thread_id: task.thread_id } });
      this.#queue.push(taskId);
      void this.#pump();
      return { accepted: true, deduplicated: false, task: updated, task_id: taskId, status: updated.status };
    } finally {
      this.#continuationChecks.delete(taskId);
    }
  }

  snapshot(): {
    max_workers: number;
    running_workers: number;
    queue_depth: number;
    waiting_task_ids: string[];
    active: ActiveTask[];
    workers: WorkerSlot[];
  } {
    return {
      max_workers: this.pool.maxWorkers,
      running_workers: this.pool.runningCount(),
      queue_depth: this.#queue.length,
      waiting_task_ids: [...this.#queue],
      active: [...this.#active.values()].map((item) => ({ ...item, decision: { ...item.decision } })),
      workers: this.pool.snapshot(),
    };
  }

  #safeUpdate(taskId: string, patch: Record<string, unknown>): TaskRecord | null {
    try {
      return this.store.update(taskId, patch);
    } catch (error) {
      this.#report(error);
      return null;
    }
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (this.#queue.length > 0 && this.pool.runningCount() < this.pool.maxWorkers) {
        const taskId = this.#queue.shift()!;
        const pending = this.#pending.get(taskId);
        const task = this.store.get(taskId);
        if (!pending || !["WAITING", "RETRYING"].includes(task.status)) continue;
        const slot = this.pool.acquire(taskId);
        if (!slot) {
          this.#queue.unshift(taskId);
          break;
        }
        void this.#startTask(taskId, slot.worker_id, pending).catch((error) => this.#handleStartFailure(taskId, slot.worker_id, error));
      }
    } finally {
      this.#pumping = false;
    }
  }

  async #startTask(taskId: string, workerId: string, pending: PendingTask): Promise<void> {
    const task = this.store.get(taskId);
    const claimId = pending.definition.write_roots.length > 0 ? `claim:${taskId}` : null;
    if (claimId) {
      try {
        this.claims.claim(taskId, pending.definition.write_roots, claimId);
      } catch (error) {
        if (error instanceof WriteClaimConflictError) {
          this.#safeUpdate(taskId, {
            status: "BLOCKED",
            worker_id: null,
            last_error: error.message,
          });
          this.pool.update(workerId, { status: "BLOCKED", phase: "write-claim-conflict", error: error.message });
          this.pool.release(workerId);
          this.#queue.push(taskId);
          return;
        }
        throw error;
      }
    }
    this.#safeUpdate(taskId, {
      status: "STARTING",
      worker_id: workerId,
      started_at: task.started_at ?? new Date().toISOString(),
      last_error: null,
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
      this.#release(taskId, workerId, claimId);
      this.#safeUpdate(taskId, {
        status: decision.status === "unavailable" ? "BLOCKED" : "BLOCKED",
        worker_id: null,
        last_error: decision.reason,
      });
      return;
    }
    let servicePlan: ServiceSessionPlan | null = null;
    if (this.serviceSessions.store) {
      if (pending.definition.existing_thread_id && task.execution_source === "bridge") {
        const mapped = this.serviceSessions.claimExistingThread(
          pending.definition.existing_thread_id,
          taskId,
        );
        if (mapped) {
          servicePlan = {
            session_id: mapped.session_id,
            kind: mapped.kind,
            workspace: mapped.workspace,
            thread_id: mapped.thread_id,
            mode: "resume",
            generation: mapped.generation,
          };
        }
      } else if (!pending.definition.existing_thread_id) {
        servicePlan = this.serviceSessions.planForTask(pending.definition.cwd, taskId);
      }
    }
    this.pool.update(workerId, {
      phase: "thread/start",
      policy_model: decision.model,
      policy_effort: decision.effort,
      requested_model: decision.selection_mode === "manual" ? decision.model : null,
      requested_effort: decision.effort,
      write_claim: claimId,
      retry_count: task.retry_count,
    });
    let thread: AppServerThreadResult;
    const resumeThreadId = pending.definition.existing_thread_id ?? servicePlan?.thread_id ?? null;
    if (resumeThreadId) {
      try {
        thread = await this.adapter.threadResume(resumeThreadId, {
          cwd: pending.definition.cwd,
          model: decision.model,
          ...(pending.definition.approval_policy ? { approvalPolicy: pending.definition.approval_policy } : {}),
        });
      } catch (error) {
        if (!servicePlan || pending.definition.existing_thread_id) throw error;
        if (!isThreadResumeBusyError(error)) throw error;
        servicePlan = this.serviceSessions.planFresh(
          pending.definition.cwd,
          taskId,
          "external-active-writer",
        );
        thread = await this.adapter.threadStart({
          cwd: pending.definition.cwd,
          model: decision.model,
          serviceName: "local-codex-bridge-service-codex",
          sandbox: pending.definition.sandbox,
          ...(pending.definition.approval_policy ? { approvalPolicy: pending.definition.approval_policy } : {}),
        });
      }
    } else {
      thread = await this.adapter.threadStart({
        cwd: pending.definition.cwd,
        model: decision.model,
        serviceName: servicePlan ? "local-codex-bridge-service-codex" : "local-codex-bridge",
        sandbox: pending.definition.sandbox,
        ...(pending.definition.approval_policy ? { approvalPolicy: pending.definition.approval_policy } : {}),
      });
    }
    if (servicePlan) {
      this.serviceSessions.bindThread(servicePlan, thread.thread_id, taskId);
    }
    this.#safeUpdate(taskId, { thread_id: thread.thread_id });
    const turn = await this.adapter.turnStart({
      threadId: thread.thread_id,
      input: [{ type: "text", text: pending.definition.text, text_elements: [] }],
      cwd: pending.definition.cwd,
      model: decision.model,
      effort: decision.effort,
      ...(thread.raw.sandbox ? { sandboxPolicy: thread.raw.sandbox } : {}),
      ...(pending.definition.approval_policy ? { approvalPolicy: pending.definition.approval_policy } : {}),
    });
    this.#safeUpdate(taskId, { turn_id: turn.turn_id, status: "RUNNING" });
    const observedModel = turn.model ?? thread.model;
    const observedEffort = turn.reasoning_effort ?? thread.reasoning_effort;
    this.#active.set(taskId, {
      taskId,
      workerId,
      claimId,
      decision,
      threadId: thread.thread_id,
      turnId: turn.turn_id,
      serviceSessionId: servicePlan?.session_id ?? null,
    });
    this.#runtime.markTurnAccepted(thread.thread_id, turn.turn_id);
    if (servicePlan) {
      this.serviceSessions.markTurnAccepted(servicePlan.session_id, taskId);
    }
    this.modelGuard.markAccepted(decision, { model: observedModel, effort: observedEffort });
    if (observedModel !== decision.model || observedEffort !== decision.effort) {
      this.#safeUpdate(taskId, {
        status: "RECOVERY_REQUIRED",
        last_error: "App Server did not confirm the required Luna/max model policy",
      });
      this.pool.update(workerId, {
        phase: "recovery-required",
        observed_model: observedModel,
        observed_effort: observedEffort,
        error: "observed model/effort mismatch",
      });
    }
    this.pool.update(workerId, {
      phase: "running",
      thread_id: thread.thread_id,
      turn_id: turn.turn_id,
      observed_model: turn.model ?? thread.model,
      observed_effort: turn.reasoning_effort ?? thread.reasoning_effort ?? decision.effort,
    });
  }

  async #handleStartFailure(taskId: string, workerId: string, error: unknown): Promise<void> {
    const active = this.#active.get(taskId);
    if (active) return;
    const task = this.store.get(taskId);
    const pending = this.#pending.get(taskId);
    const message = error instanceof Error ? error.message : String(error);
    const ambiguous = /UNKNOWN|already-sent mutating request/i.test(message);
    if (ambiguous) {
      this.#release(taskId, workerId, pending?.definition.write_roots.length ? `claim:${taskId}` : null);
      this.#safeUpdate(taskId, { status: "RECOVERY_REQUIRED", worker_id: null, last_error: message });
      return;
    }
    if (isServerOverloaded(error) && task.retry_count < this.#maxRetries && pending) {
      const retryCount = task.retry_count + 1;
      const delay = exponentialBackoffMs(task.retry_count, {}, this.#random);
      this.#release(taskId, workerId, pending.definition.write_roots.length ? `claim:${taskId}` : null);
      this.#safeUpdate(taskId, { status: "RETRYING", retry_count: retryCount, worker_id: null, last_error: message });
      const timer = setTimeout(() => {
        delete this.#pending.get(taskId)!.retryTimer;
        this.#safeUpdate(taskId, { status: "WAITING" });
        this.#queue.push(taskId);
        void this.#pump();
      }, delay);
      this.#pending.get(taskId)!.retryTimer = timer;
      return;
    }
    this.#release(taskId, workerId, pending?.definition.write_roots.length ? `claim:${taskId}` : null);
    this.#safeUpdate(taskId, { status: "FAILED", worker_id: null, completed_at: new Date().toISOString(), last_error: message });
  }

  #handleLifecycle(signal: RuntimeTaskLifecycleSignal): void {
    if (signal.kind !== "turn_completed") return;
    const task = this.store.findByThreadTurn(signal.thread_id, signal.turn_id);
    if (!task) return;
    if (task.execution_source !== "bridge") return;
    const active = this.#active.get(task.id);
    const workerId = active?.workerId ?? task.worker_id;
    if (!workerId) return;
    const claimId = active?.claimId ?? (task.write_claims.length > 0 ? `claim:${task.id}` : null);
    const normalizedStatus = signal.status.toLowerCase();
    const completed = !signal.failed && ["complete", "completed", "success", "succeeded"].includes(normalizedStatus);
    const interrupted = ["interrupted", "cancelled", "canceled"].includes(normalizedStatus);
    const completionTask = {
      ...task,
      status: completed ? "COMPLETED" : interrupted ? "INTERRUPTED" : "FAILED",
    } as TaskRecord;
    const executionResult = buildExecutionResult(completionTask, {
      process_started: true,
      command_success: completed,
      error_code: completed ? null : "execution_failed",
    });
    this.#safeUpdate(task.id, {
      status: completed ? "COMPLETED" : interrupted ? "INTERRUPTED" : "FAILED",
      completed_at: new Date().toISOString(),
      worker_id: null,
      last_error: completed ? null : "Codex turn terminal: " + signal.status,
      result_summary: completed ? "Codex 回合已完成" : task.result_summary,
      result_manifest: {
        ...task.result_manifest,
        integrity: executionResult.output_manifest,
        execution_result: executionResult,
      },
    });
    this.serviceSessions.complete(task.id, completed);
    this.#finalizeResult(task.id);
    this.#release(task.id, workerId, claimId);
    this.#pending.delete(task.id);
    void this.#pump();
  }

  #release(taskId: string, workerId: string, claimId: string | null): void {
    this.serviceSessions.complete(taskId, false);
    if (claimId) this.claims.release(claimId);
    this.#active.delete(taskId);
    this.pool.release(workerId);
  }

  async #reconcileTask(task: TaskRecord): Promise<void> {
    if (!task.thread_id || !task.turn_id) {
      this.#safeUpdate(task.id, { status: "RECOVERY_REQUIRED", last_error: "Unfinished task has no durable thread/turn mapping" });
      return;
    }
    try {
      const mappedServiceSession = task.thread_id && task.execution_source === "bridge" && this.serviceSessions.store
        ? this.serviceSessions.claimExistingThread(task.thread_id, task.id)
        : null;
      if (
        task.thread_id &&
        task.execution_source === "bridge" &&
        this.serviceSessions.store?.byThread(task.thread_id) &&
        !mappedServiceSession
      ) {
        this.#safeUpdate(task.id, {
          status: "RECOVERY_REQUIRED",
          last_error: "Bridge Agent service thread is already leased by another task",
        });
        return;
      }
      const result = await this.adapter.threadRead(task.thread_id, true);
      const thread = result.thread as Record<string, unknown> | undefined;
      const turns = thread && Array.isArray(thread.turns) ? thread.turns : [];
      const turn = turns.find((candidate) => candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).id === task.turn_id) as Record<string, unknown> | undefined;
      const status = typeof turn?.status === "string" ? turn.status.toLowerCase() : "";
      if (["complete", "completed", "success", "succeeded"].includes(status)) {
        this.serviceSessions.complete(task.id, true);
        this.#safeUpdate(task.id, { status: "COMPLETED", completed_at: task.completed_at ?? new Date().toISOString(), worker_id: null });
        this.#finalizeResult(task.id);
        return;
      }
      if (["failed", "error", "interrupted", "cancelled"].includes(status)) {
        this.serviceSessions.complete(task.id, false);
        this.#safeUpdate(task.id, { status: status === "interrupted" ? "INTERRUPTED" : "FAILED", completed_at: task.completed_at ?? new Date().toISOString(), worker_id: null, last_error: `authoritative turn status: ${status}` });
        this.#finalizeResult(task.id);
        return;
      }
      if (["inprogress", "running", "in_progress"].includes(status)) {
        const claimId = task.write_claims.length > 0 ? `claim:${task.id}` : null;
        if (claimId) {
          try {
            this.claims.claim(task.id, task.write_claims, claimId);
          } catch (error) {
            this.#safeUpdate(task.id, { status: "RECOVERY_REQUIRED", last_error: error instanceof Error ? error.message : String(error) });
            this.#report(error);
            return;
          }
        }
        const slot = this.pool.acquire(task.id);
        if (!slot) {
          if (claimId) this.claims.release(claimId);
          this.#safeUpdate(task.id, { status: "RECOVERY_REQUIRED", last_error: "Authoritative turn is running but no Luna worker slot is available" });
          return;
        }
        this.#active.set(task.id, {
          taskId: task.id,
          workerId: slot.worker_id,
          claimId,
          decision: {
            allowed: true,
            model: this.modelGuard.policyModel() ?? "",
            effort: "max",
            selection_mode: "automatic",
            quota_mode: "protected",
            policy_status: "active",
            task_type: task.type,
            task_complexity: "normal",
            reason: "default-policy",
          },
          threadId: task.thread_id,
          turnId: task.turn_id,
          serviceSessionId: mappedServiceSession?.session_id ?? null,
        });
        this.#safeUpdate(task.id, { status: "RUNNING", worker_id: slot.worker_id });
        this.pool.update(slot.worker_id, { phase: "reconciled-running", thread_id: task.thread_id, turn_id: task.turn_id, write_claim: claimId });
        return;
      }
      this.#safeUpdate(task.id, { status: "RECOVERY_REQUIRED", last_error: "Authoritative thread/read did not expose a decisive turn state" });
    } catch (error) {
      this.#safeUpdate(task.id, { status: "RECOVERY_REQUIRED", last_error: error instanceof Error ? error.message : String(error) });
      this.#report(error);
    }
  }

  #report(error: unknown): void {
    try { this.#onError?.(error); } catch { /* diagnostics cannot break scheduling */ }
  }

  #finalizeResult(taskId: string): void {
    try {
      this.resultService.finalize(taskId);
    } catch (error) {
      this.#report(error);
    }
  }
}
