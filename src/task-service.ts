import { normalizeTaskDefinition, type TaskDefinitionInput } from "./task-definition.js";
import type {
  BridgeTaskScheduler,
  TaskActionRejected,
  TaskSubmissionResult,
} from "./ephemeral-scheduler.js";
import { WorkingDirectoryResolver } from "./working-directory.js";

export interface TaskCancellationResult {
  accepted: boolean;
  task_id: string;
  status: "cancel_requested" | "cancelled" | "not_running" | "not_allowed";
  reason: string | null;
  cancel_requested: boolean;
  task: import("./task-manager.js").TaskRecord;
}

export class TaskService {
  readonly #scheduler: BridgeTaskScheduler;
  readonly #workingDirectoryResolver: WorkingDirectoryResolver | undefined;

  constructor(scheduler: BridgeTaskScheduler, workingDirectoryResolver?: WorkingDirectoryResolver) {
    this.#scheduler = scheduler;
    this.#workingDirectoryResolver = workingDirectoryResolver;
  }

  submit(input: TaskDefinitionInput): TaskSubmissionResult {
    if (!this.#workingDirectoryResolver && !/^[A-Za-z]:[\\/]/.test(input.cwd)) {
      throw new Error("cwd must be an absolute Windows drive-letter path");
    }
    const cwd = this.#workingDirectoryResolver
      ? this.#workingDirectoryResolver.resolve(input.cwd).safe_process_cwd
      : input.cwd;
    const definition = normalizeTaskDefinition({ ...input, cwd });
    return this.#scheduler.submit(definition);
  }

  async continueTask(taskId: string, instruction: string): Promise<TaskSubmissionResult | TaskActionRejected> {
    const task = this.#scheduler.store.get(taskId);
    if (task.execution_source !== "bridge") {
      return {
        accepted: false,
        task_id: taskId,
        status: "RECOVERY_REQUIRED",
        reason: "external/native task continuation requires an explicit thread_id",
        task,
      };
    }
    if (!task.cwd || !/^[A-Za-z]:[\\/]/.test(task.cwd)) {
      return {
        accepted: false,
        task_id: taskId,
        status: "RECOVERY_REQUIRED",
        reason: task.cwd ? "task has no valid durable Windows cwd" : "task has no durable cwd",
        task,
      };
    }
    const definition = normalizeTaskDefinition({
      title: task.name,
      text: instruction,
      cwd: task.cwd,
      task_type: task.type,
      sandbox: task.write_claims.length > 0 ? "workspace-write" : "read-only",
      write_roots: task.write_claims,
      ...(task.thread_id === null ? {} : { existing_thread_id: task.thread_id }),
    });
    return await this.#scheduler.continueTask(taskId, definition);
  }

  taskInput(taskId: string): string | null {
    return this.#scheduler.taskInput?.(taskId) ?? null;
  }

  cancelTask(taskId: string): TaskCancellationResult {
    const task = this.#scheduler.store.get(taskId);
    if (task.execution_source !== "bridge") {
      return {
        accepted: false,
        task_id: taskId,
        status: "not_allowed",
        reason: "only AGENTS tasks can be cancelled from the Control Center",
        cancel_requested: false,
        task,
      };
    }
    if (task.status === "RECOVERY_REQUIRED") {
      const updated = this.#scheduler.store.endRecovery(taskId);
      return {
        accepted: true,
        task_id: taskId,
        status: "cancelled",
        reason: null,
        cancel_requested: false,
        task: updated,
      };
    }
    if (["DONE", "COMPLETED", "FAILED", "INTERRUPTED", "BLOCKED"].includes(task.status)) {
      return {
        accepted: false,
        task_id: taskId,
        status: "not_running",
        reason: "task is already terminal",
        cancel_requested: false,
        task,
      };
    }
    const cancelled = this.#scheduler.cancel?.(taskId) ?? false;
    if (!cancelled) {
      return {
        accepted: false,
        task_id: taskId,
        status: "not_running",
        reason: "task is no longer queued or running",
        cancel_requested: false,
        task: this.#scheduler.store.get(taskId),
      };
    }
    const updated = this.#scheduler.store.get(taskId);
    const requested = this.#scheduler.cancelRequested?.(taskId) ?? false;
    return {
      accepted: true,
      task_id: taskId,
      status: updated.status === "INTERRUPTED" ? "cancelled" : "cancel_requested",
      reason: null,
      cancel_requested: requested,
      task: updated,
    };
  }

  scheduler(): BridgeTaskScheduler {
    return this.#scheduler;
  }

  result(taskId: string) {
    return this.#scheduler.resultService.get(taskId);
  }

  markReviewed(taskId: string) {
    return this.#scheduler.resultService.markReviewed(taskId);
  }
}
