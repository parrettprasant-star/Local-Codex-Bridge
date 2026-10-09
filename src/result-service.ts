import { TaskManager, TaskNotFoundError } from "./task-manager.js";
import {
  defaultResultIntegrity,
  isTerminalExecutionStatus,
  type ResultIntegrity,
  type ResultManifest,
} from "./result-manifest.js";
import { verifyResultIntegrity } from "./result-integrity.js";
import {
  buildExecutionResult,
  completionContractFailure,
  completionFailureMessage,
} from "./execution-result.js";

export class ResultReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultReviewError";
  }
}

function uniqueWarnings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].slice(0, 50);
}

export class ResultService {
  readonly #manager: TaskManager;

  constructor(manager: TaskManager) {
    this.#manager = manager;
  }

  get(taskId: string): ResultManifest {
    return this.#manager.get(taskId).result_manifest;
  }

  finalize(taskId: string): ResultManifest {
    const task = this.#manager.get(taskId);
    const integrity = this.#safeIntegrity(task);
    const executionResult = buildExecutionResult(task);
    const contractFailed = isTerminalExecutionStatus(task.status) &&
      (task.status === "COMPLETED" || task.status === "DONE") &&
      completionContractFailure(executionResult);
    const verifiedOutputFiles = contractFailed
      ? [...task.output_files]
      : [...new Set([...task.output_files, ...executionResult.verified_outputs])];
    const reviewStatus = !contractFailed && (task.status === "COMPLETED" || task.status === "DONE")
      ? "READY"
      : "NOT_READY";
    const updated = this.#manager.update(taskId, {
      ...(contractFailed
        ? {
            status: "FAILED",
            progress: Math.min(task.progress, 99),
            stage: "执行失败",
            current_action: "输出校验失败",
            next_action: "检查输出并重试",
            last_error: completionFailureMessage(executionResult),
          }
        : {}),
      output_files: verifiedOutputFiles,
      result_manifest: {
        ...task.result_manifest,
        warnings: uniqueWarnings([...task.result_manifest.warnings, ...integrity.warnings]),
        integrity,
        execution_result: executionResult,
        review_status: reviewStatus,
      },
    });
    return updated.result_manifest;
  }

  refreshIntegrity(taskId: string): ResultManifest {
    return this.finalize(taskId);
  }

  markReviewed(taskId: string): ResultManifest {
    const task = this.#manager.get(taskId);
    if (!isTerminalExecutionStatus(task.status)) {
      throw new ResultReviewError("task execution is not terminal");
    }
    if (task.result_manifest.review_status !== "READY" && task.result_manifest.review_status !== "REVIEWED") {
      throw new ResultReviewError("task result is not ready for review");
    }
    return this.#manager.update(taskId, {
      result_manifest: {
        ...task.result_manifest,
        review_status: "REVIEWED",
      },
    }).result_manifest;
  }

  static isTaskNotFound(error: unknown): boolean {
    return error instanceof TaskNotFoundError;
  }

  #safeIntegrity(task: ReturnType<TaskManager["get"]>): ResultIntegrity {
    try {
      return verifyResultIntegrity(task);
    } catch (error) {
      const integrity = defaultResultIntegrity();
      integrity.status = "ERROR";
      integrity.checked_at = new Date().toISOString();
      integrity.error_summary = error instanceof Error ? error.message : String(error);
      integrity.warnings = ["Result integrity check failed before verification"];
      return integrity;
    }
  }
}
