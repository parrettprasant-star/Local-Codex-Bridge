import type { TaskRecord } from "./task-manager.js";
import {
  type ResultIntegrity,
  type ResultManifest,
  type ExecutionResultContract,
} from "./result-manifest.js";
import { verifyResultIntegrity } from "./result-integrity.js";

export interface ExecutionResultOverrides {
  process_started?: boolean;
  process_exit_code?: number | null;
  command_success?: boolean;
  error_code?: string | null;
  retryable?: boolean;
}

function successfulStatus(status: TaskRecord["status"]): boolean {
  return status === "DONE" || status === "COMPLETED";
}

function requiredOutputs(manifest: ResultManifest): string[] {
  return Array.isArray(manifest.required_outputs)
    ? [...manifest.required_outputs]
    : [];
}

function entryForPath(integrity: ResultIntegrity, value: string) {
  return integrity.entries.find((entry) => entry.path === value) ?? null;
}

function errorCodeFor(
  task: TaskRecord,
  integrity: ResultIntegrity,
  missing: readonly string[],
  commandSuccess: boolean,
): string | null {
  if (!commandSuccess) {
    if (/CreateProcessAsUserW\s+failed:\s*267|error\s*267|invalid directory/i.test(task.last_error ?? "")) {
      return "win32_create_process_invalid_directory_267";
    }
    return "execution_failed";
  }
  if (missing.length > 0) {
    const entries = missing.map((value) => entryForPath(integrity, value));
    if (entries.some((entry) => entry?.verification === "ZERO_BYTE")) return "required_output_empty";
    if (entries.some((entry) => entry?.verification === "OUT_OF_SCOPE")) return "required_output_out_of_scope";
    return "required_output_missing";
  }
  return null;
}

export function buildExecutionResult(
  task: TaskRecord,
  overrides: ExecutionResultOverrides = {},
): ExecutionResultContract {
  const integrity = verifyResultIntegrity(task);
  const required = requiredOutputs(task.result_manifest);
  const missing = required.filter((value) => entryForPath(integrity, value)?.verification !== "PASS");
  const previous = task.result_manifest.execution_result;
  const commandSuccess = overrides.command_success ?? previous?.command_success ?? successfulStatus(task.status);
  const errorCode = overrides.error_code === undefined
    ? errorCodeFor(task, integrity, missing, commandSuccess)
    : overrides.error_code;
  return {
    process_started: overrides.process_started ?? previous?.process_started ?? task.started_at !== null,
    process_exit_code: overrides.process_exit_code ?? previous?.process_exit_code ?? null,
    command_success: commandSuccess,
    required_outputs: required,
    verified_outputs: required.filter((value) => entryForPath(integrity, value)?.verification === "PASS"),
    missing_outputs: missing,
    output_manifest: integrity,
    error_code: errorCode,
    retryable: overrides.retryable ?? previous?.retryable ?? false,
  };
}

export function completionContractFailure(result: ExecutionResultContract): boolean {
  return result.required_outputs.length > 0 && (
    !result.process_started ||
    !result.command_success ||
    result.missing_outputs.length > 0
  );
}

export function completionFailureMessage(result: ExecutionResultContract): string {
  if (result.error_code === "required_output_empty") return "任务输出文件为空，未完成。";
  if (result.error_code === "required_output_out_of_scope") return "任务输出不在允许目录内，未完成。";
  if (result.error_code === "required_output_missing") return "任务要求的输出文件未生成，未完成。";
  if (result.error_code === "win32_create_process_invalid_directory_267") return "任务无法在指定工作目录启动，本地执行器未运行。";
  if (result.error_code === "execution_failed") return "本地执行未成功，任务未完成。";
  return "任务输出校验未通过，任务未完成。";
}
