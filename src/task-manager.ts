import { randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { TaskStatus as LegacyTaskStatus } from "./task-status.js";
import {
  RESULT_INTEGRITY_STATUSES,
  RESULT_VERIFICATIONS,
  REVIEW_STATUSES,
  defaultResultIntegrity,
  defaultResultManifest,
  isTerminalExecutionStatus,
  resumeCommand,
  type ResultIntegrity,
  type ResultIntegrityEntry,
  type ResultManifest,
  type ResultManifestTaskFields,
  type ReviewStatus,
} from "./result-manifest.js";
import type { ExecutionResultContract } from "./result-manifest.js";
import { normalizeRequiredOutputPaths } from "./working-directory.js";
import {
  buildExecutionResult,
  completionContractFailure,
  completionFailureMessage,
} from "./execution-result.js";

export const TASK_MANAGER_FILE_ENV = "LOCAL_CODEX_BRIDGE_TASKS_FILE";
export const TASK_MANAGER_SCHEMA_VERSION = 7;

const PREVIOUS_TASK_MANAGER_SCHEMA_VERSION = 6;
const LEGACY_V5_TASK_MANAGER_SCHEMA_VERSION = 5;
const LEGACY_V4_TASK_MANAGER_SCHEMA_VERSION = 4;
const LEGACY_V3_TASK_MANAGER_SCHEMA_VERSION = 3;
const LEGACY_TASK_MANAGER_SCHEMA_VERSION = 2;
const MAX_TASKS = 100;
const MAX_TASK_ID = 100;
const MAX_TEXT = 500;
const MAX_COMPLETED_ITEMS = 100;
const MAX_OUTPUT_FILES = 50;
const MAX_OUTPUT_FILE_CHARS = 1_000;
const MAX_RESULT_SUMMARY_CHARS = 500;
const MAX_FINAL_ANSWER_CHARS = 100_000;
const MAX_FINGERPRINT_CHARS = 256;
const MAX_WORKER_ID_CHARS = 100;
const MAX_CWD_CHARS = 1_000;
const MAX_WRITE_CLAIMS = 50;
const MAX_WRITE_CLAIM_CHARS = 1_000;
const MAX_OUTPUT_DIRECTORIES = 50;
const MAX_RESULT_WARNINGS = 50;
const MAX_INTEGRITY_ENTRIES = 100;
const MAX_RESULT_PATH_CHARS = 1_000;
const MAX_LAST_ERROR_CHARS = 2_000;
const MAX_EVENTS = 500;

export const TASK_STATUSES = [
  "WAITING",
  "STARTING",
  "RUNNING",
  "RETRYING",
  "BLOCKED",
  "COMPLETED",
  "INTERRUPTED",
  "RECOVERY_REQUIRED",
  "PAUSED",
  "NEED_CONFIRM",
  "DONE",
  "FAILED",
] as const;

export const TASK_EXECUTION_SOURCES = ["bridge", "external/native"] as const;
export type TaskExecutionSource = (typeof TASK_EXECUTION_SOURCES)[number];

export const TASK_ACCOUNTS = ["示例账号A", "示例账号B", "示例账号C", "企业号"] as const;
export const TASK_SKILLS = ["企业号图文Skill", "素材任务Skill", "KOS攻略Skill"] as const;

export const TASK_EVENT_STREAM_TYPES = [
  "TASK_CREATED",
  "TASK_STARTED",
  "STAGE_CHANGED",
  "PROGRESS_UPDATED",
  "WAITING_CONFIRM",
  "FILE_FOUND",
  "FILE_PROCESSED",
  "ERROR",
  "TASK_COMPLETED",
] as const;

export const TASK_EVENT_TYPES = [
  "task.created",
  "task.updated",
  "task.waiting",
  "task.started",
  "task.progressed",
  "task.item_completed",
  "task.needs_confirmation",
  "task.confirmed",
  "task.paused",
  "task.resumed",
  "task.completed",
  "task.failed",
  "task.cancelled",
  ...TASK_EVENT_STREAM_TYPES,
] as const;

export type TaskLifecycle = (typeof TASK_STATUSES)[number];
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export interface TaskEventPayload {
  message?: string;
  stage?: string;
  progress?: number;
  source?: string;
  item?: string;
  current_action?: string;
  next_action?: string;
  status?: TaskLifecycle;
  completed_count?: number;
  total_count?: number;
  output_files?: string[];
  output_directories?: string[];
  result_summary?: string;
}

export interface TaskEvent {
  event_id: string;
  task_id: string;
  type: TaskEventType;
  at: string;
  status: TaskLifecycle;
  payload: TaskEventPayload;
}

export interface TaskRecord {
  id: string;
  fingerprint: string;
  name: string;
  type: string;
  execution_source: TaskExecutionSource;
  account: string;
  skill: string;
  status: TaskLifecycle;
  progress: number;
  stage: string;
  current_action: string;
  next_action: string;
  completed_items: string[];
  output_files: string[];
  output_directories: string[];
  result_summary: string;
  final_answer: string;
  result_manifest: ResultManifest;
  worker_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  cwd: string;
  write_claims: string[];
  started_at: string | null;
  completed_at: string | null;
  retry_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskManagerSnapshot {
  schema_version: typeof TASK_MANAGER_SCHEMA_VERSION;
  active_task_id: string | null;
  tasks: TaskRecord[];
  events: TaskEvent[];
  updated_at: string;
}

export interface TaskCreateInput {
  name: string;
  fingerprint?: string;
  type?: string;
  execution_source?: TaskExecutionSource;
  account?: string;
  skill?: string;
  status?: TaskLifecycle;
  progress?: number;
  stage?: string;
  current_action?: string;
  next_action?: string;
  completed_items?: string[];
  output_files?: string[];
  output_directories?: string[];
  result_summary?: string;
  final_answer?: string;
  result_manifest?: ResultManifest;
  worker_id?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
  cwd?: string;
  write_claims?: string[];
  started_at?: string | null;
  completed_at?: string | null;
  retry_count?: number;
  last_error?: string | null;
  active?: boolean;
}

export interface TaskUpdateInput {
  fingerprint?: string;
  name?: string;
  type?: string;
  execution_source?: TaskExecutionSource;
  account?: string;
  skill?: string;
  status?: TaskLifecycle;
  progress?: number;
  stage?: string;
  current_action?: string;
  next_action?: string;
  completed_items?: string[];
  output_files?: string[];
  output_directories?: string[];
  result_summary?: string;
  final_answer?: string;
  result_manifest?: ResultManifest;
  worker_id?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
  cwd?: string;
  write_claims?: string[];
  started_at?: string | null;
  completed_at?: string | null;
  retry_count?: number;
  last_error?: string | null;
  active?: boolean;
}

interface LoadedSnapshot {
  snapshot: TaskManagerSnapshot;
  migratedFrom: 2 | 3 | 4 | 5 | 6 | null;
}

export class TaskManagerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskManagerValidationError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super("Task not found: " + taskId);
    this.name = "TaskNotFoundError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function text(
  value: unknown,
  field: string,
  allowEmpty = true,
  maximum = MAX_TEXT,
): string {
  if (typeof value !== "string") {
    throw new TaskManagerValidationError(field + " must be a string");
  }
  if (!allowEmpty && value.length === 0) {
    throw new TaskManagerValidationError(field + " must not be empty");
  }
  if (value.length > maximum) {
    throw new TaskManagerValidationError(field + " must be at most " + maximum + " characters");
  }
  return value;
}

function status(value: unknown, field = "status"): TaskLifecycle {
  if (typeof value !== "string") {
    throw new TaskManagerValidationError(field + " must be one of: " + TASK_STATUSES.join(", "));
  }
  const aliases: Record<string, TaskLifecycle> = {
    WAITING: "WAITING",
    queued: "WAITING",
    waiting: "WAITING",
    STARTING: "STARTING",
    starting: "STARTING",
    RUNNING: "RUNNING",
    running: "RUNNING",
    RETRYING: "RETRYING",
    retrying: "RETRYING",
    BLOCKED: "BLOCKED",
    blocked: "BLOCKED",
    COMPLETED: "COMPLETED",
    completed_state: "COMPLETED",
    INTERRUPTED: "INTERRUPTED",
    interrupted: "INTERRUPTED",
    RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
    recovery_required: "RECOVERY_REQUIRED",
    PAUSED: "PAUSED",
    paused: "PAUSED",
    NEED_CONFIRM: "NEED_CONFIRM",
    need_confirm: "NEED_CONFIRM",
    needConfirmation: "NEED_CONFIRM",
    DONE: "DONE",
    done: "DONE",
    completed: "DONE",
    FAILED: "FAILED",
    failed: "FAILED",
    cancelled: "FAILED",
    canceled: "FAILED",
  };
  const normalized = aliases[value];
  if (!normalized) {
    throw new TaskManagerValidationError(field + " must be one of: " + TASK_STATUSES.join(", "));
  }
  return normalized;
}

function executionSource(value: unknown, field = "execution_source"): TaskExecutionSource {
  if (typeof value !== "string" || !TASK_EXECUTION_SOURCES.includes(value as TaskExecutionSource)) {
    throw new TaskManagerValidationError(
      field + " must be one of: " + TASK_EXECUTION_SOURCES.join(", "),
    );
  }
  return value as TaskExecutionSource;
}

function inferredExecutionSource(value: Record<string, unknown>): TaskExecutionSource {
  if (value.execution_source !== undefined) {
    return executionSource(value.execution_source);
  }
  return typeof value.fingerprint === "string" && value.fingerprint.startsWith("runtime:")
    ? "external/native"
    : "bridge";
}

function progress(value: unknown, field = "progress"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new TaskManagerValidationError(field + " must be an integer from 0 to 100");
  }
  return value;
}

function completedItems(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_COMPLETED_ITEMS) {
    throw new TaskManagerValidationError(
      "completed_items must be an array with at most " + MAX_COMPLETED_ITEMS + " items",
    );
  }
  return value.map((item, index) => text(item, "completed_items[" + index + "]", false));
}

function outputFiles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_OUTPUT_FILES) {
    throw new TaskManagerValidationError(
      "output_files must be an array with at most " + MAX_OUTPUT_FILES + " items",
    );
  }
  return value.map((item, index) => {
    const output = text(
      item,
      "output_files[" + index + "]",
      false,
      MAX_OUTPUT_FILE_CHARS,
    );
    if (
      output.includes(String.fromCharCode(0)) ||
      output.includes(String.fromCharCode(13)) ||
      output.includes(String.fromCharCode(10))
    ) {
      throw new TaskManagerValidationError(
        "output_files[" + index + "] must not contain control characters",
      );
    }
    return output;
  });
}

function outputDirectories(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_OUTPUT_DIRECTORIES) {
    throw new TaskManagerValidationError(
      "output_directories must be an array with at most " + MAX_OUTPUT_DIRECTORIES + " items",
    );
  }
  return value.map((item, index) => {
    const output = text(
      item,
      "output_directories[" + index + "]",
      false,
      MAX_WRITE_CLAIM_CHARS,
    );
    if (/\r|\n|\0/.test(output)) {
      throw new TaskManagerValidationError(
        "output_directories[" + index + "] must not contain control characters",
      );
    }
    return output;
  });
}

function writeClaims(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_WRITE_CLAIMS) {
    throw new TaskManagerValidationError(
      "write_claims must be an array with at most " + MAX_WRITE_CLAIMS + " items",
    );
  }
  return value.map((item, index) =>
    text(item, "write_claims[" + index + "]", false, MAX_WRITE_CLAIM_CHARS),
  );
}

function nullableText(
  value: unknown,
  field: string,
  maximum: number,
): string | null {
  if (value === null) {
    return null;
  }
  return text(value, field, false, maximum);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TaskManagerValidationError(field + " must be a boolean");
  }
  return value;
}

function resultReviewStatus(value: unknown, field = "review_status"): ReviewStatus {
  if (typeof value !== "string" || !REVIEW_STATUSES.includes(value as ReviewStatus)) {
    throw new TaskManagerValidationError(
      field + " must be one of: " + REVIEW_STATUSES.join(", "),
    );
  }
  return value as ReviewStatus;
}

function resultIntegrityStatus(value: unknown): ResultIntegrity["status"] {
  if (typeof value !== "string" || !RESULT_INTEGRITY_STATUSES.includes(value as ResultIntegrity["status"])) {
    throw new TaskManagerValidationError(
      "integrity.status must be one of: " + RESULT_INTEGRITY_STATUSES.join(", "),
    );
  }
  return value as ResultIntegrity["status"];
}

function resultVerification(value: unknown): ResultIntegrityEntry["verification"] {
  if (typeof value !== "string" || !RESULT_VERIFICATIONS.includes(value as ResultIntegrityEntry["verification"])) {
    throw new TaskManagerValidationError(
      "integrity entry verification must be one of: " + RESULT_VERIFICATIONS.join(", "),
    );
  }
  return value as ResultIntegrityEntry["verification"];
}

function resultActualType(value: unknown): ResultIntegrityEntry["actual_type"] {
  const values = ["file", "directory", "other", "missing", "unknown"] as const;
  if (typeof value !== "string" || !values.includes(value as ResultIntegrityEntry["actual_type"])) {
    throw new TaskManagerValidationError(
      "integrity entry actual_type must be one of: " + values.join(", "),
    );
  }
  return value as ResultIntegrityEntry["actual_type"];
}

function resultIntegrityEntry(value: unknown): ResultIntegrityEntry {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("integrity entry must be an object");
  }
  checkKeys(value, [
    "path",
    "canonical_path",
    "expected_type",
    "actual_type",
    "verification",
    "exists",
    "size_bytes",
    "modified_at",
  ]);
  if (value.expected_type !== "file" && value.expected_type !== "directory") {
    throw new TaskManagerValidationError("integrity entry expected_type must be file or directory");
  }
  return {
    path: text(value.path, "integrity entry path", false, MAX_RESULT_PATH_CHARS),
    canonical_path: value.canonical_path === null
      ? null
      : nullableText(value.canonical_path, "integrity entry canonical_path", MAX_RESULT_PATH_CHARS),
    expected_type: value.expected_type,
    actual_type: resultActualType(value.actual_type),
    verification: resultVerification(value.verification),
    exists: booleanValue(value.exists, "integrity entry exists"),
    size_bytes: value.size_bytes === null
      ? null
      : nonNegativeInteger(value.size_bytes, "integrity entry size_bytes"),
    modified_at: value.modified_at === null
      ? null
      : nullableText(value.modified_at, "integrity entry modified_at", 100),
  };
}

function resultWarnings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_RESULT_WARNINGS) {
    throw new TaskManagerValidationError(
      field + " must be an array with at most " + MAX_RESULT_WARNINGS + " items",
    );
  }
  return value.map((item, index) => text(item, field + "[" + index + "]", false, MAX_LAST_ERROR_CHARS));
}

function resultIntegrity(value: unknown): ResultIntegrity {
  if (value === undefined) {
    return defaultResultIntegrity();
  }
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("integrity must be an object");
  }
  checkKeys(value, [
    "status",
    "checked_at",
    "files_declared",
    "files_verified",
    "directories_declared",
    "directories_verified",
    "recorded_output_count",
    "declared_output_count",
    "zero_byte_files",
    "missing_paths",
    "out_of_scope_paths",
    "entries",
    "warnings",
    "error_summary",
  ]);
  if (!Array.isArray(value.entries) || value.entries.length > MAX_INTEGRITY_ENTRIES) {
    throw new TaskManagerValidationError(
      "integrity.entries must be an array with at most " + MAX_INTEGRITY_ENTRIES + " items",
    );
  }
  return {
    status: resultIntegrityStatus(value.status),
    checked_at: value.checked_at === null
      ? null
      : nullableText(value.checked_at, "integrity.checked_at", 100),
    files_declared: nonNegativeInteger(value.files_declared, "integrity.files_declared"),
    files_verified: nonNegativeInteger(value.files_verified, "integrity.files_verified"),
    directories_declared: nonNegativeInteger(value.directories_declared, "integrity.directories_declared"),
    directories_verified: nonNegativeInteger(value.directories_verified, "integrity.directories_verified"),
    recorded_output_count: nonNegativeInteger(value.recorded_output_count, "integrity.recorded_output_count"),
    declared_output_count: value.declared_output_count === null
      ? null
      : nonNegativeInteger(value.declared_output_count, "integrity.declared_output_count"),
    zero_byte_files: nonNegativeInteger(value.zero_byte_files, "integrity.zero_byte_files"),
    missing_paths: nonNegativeInteger(value.missing_paths, "integrity.missing_paths"),
    out_of_scope_paths: nonNegativeInteger(value.out_of_scope_paths, "integrity.out_of_scope_paths"),
    entries: value.entries.map(resultIntegrityEntry),
    warnings: resultWarnings(value.warnings, "integrity.warnings"),
    error_summary: value.error_summary === null
      ? null
      : nullableText(value.error_summary, "integrity.error_summary", MAX_LAST_ERROR_CHARS),
  };
}

function resultManifest(
  value: unknown,
  fields: ResultManifestTaskFields,
): ResultManifest {
  const fallback = defaultResultManifest(fields);
  if (value === undefined) {
    return fallback;
  }
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("result_manifest must be an object");
  }
  checkKeys(value, [
    "task_id",
    "task_title",
    "execution_status",
    "review_status",
    "thread_id",
    "last_turn_id",
    "worker_id",
    "workspace",
    "cwd",
    "created_at",
    "started_at",
    "completed_at",
    "result_summary",
    "output_files",
    "output_directories",
    "required_outputs",
    "execution_result",
    "warnings",
    "integrity",
    "resume_command",
  ]);
  const reviewStatus = value.review_status === undefined
    ? fallback.review_status
    : resultReviewStatus(value.review_status);
  const priorWorkerId = value.worker_id === null || value.worker_id === undefined
    ? null
    : nullableText(value.worker_id, "result_manifest.worker_id", MAX_WORKER_ID_CHARS);
  const workerId = fields.worker_id ?? (
    isTerminalExecutionStatus(fields.status) ? priorWorkerId : null
  );
  return {
    task_id: fields.id,
    task_title: fields.name,
    execution_status: fields.status,
    review_status: reviewStatus,
    thread_id: fields.thread_id,
    last_turn_id: fields.turn_id,
    worker_id: workerId,
    workspace: fields.cwd,
    cwd: fields.cwd,
    created_at: fields.created_at,
    started_at: fields.started_at,
    completed_at: fields.completed_at,
    result_summary: fields.result_summary,
    output_files: [...fields.output_files],
    output_directories: [...fields.output_directories],
    required_outputs: value.required_outputs === undefined
      ? [...(fallback.required_outputs ?? [])]
      : normalizeRequiredOutputPaths(value.required_outputs),
    ...(value.execution_result === undefined
      ? {}
      : { execution_result: executionResult(value.execution_result) }),
    warnings: value.warnings === undefined ? [] : resultWarnings(value.warnings, "result_manifest.warnings"),
    integrity: resultIntegrity(value.integrity),
    resume_command: resumeCommand(fields.thread_id),
  };
}

function executionResult(value: unknown): ExecutionResultContract {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("execution_result must be an object");
  }
  checkKeys(value, [
    "process_started",
    "process_exit_code",
    "command_success",
    "required_outputs",
    "verified_outputs",
    "missing_outputs",
    "output_manifest",
    "error_code",
    "retryable",
  ]);
  if (typeof value.process_started !== "boolean") {
    throw new TaskManagerValidationError("execution_result.process_started must be a boolean");
  }
  if (value.process_exit_code !== null && value.process_exit_code !== undefined &&
    (typeof value.process_exit_code !== "number" || !Number.isInteger(value.process_exit_code))) {
    throw new TaskManagerValidationError("execution_result.process_exit_code must be an integer or null");
  }
  if (typeof value.command_success !== "boolean") {
    throw new TaskManagerValidationError("execution_result.command_success must be a boolean");
  }
  if (typeof value.retryable !== "boolean") {
    throw new TaskManagerValidationError("execution_result.retryable must be a boolean");
  }
  if (!isRecord(value.output_manifest)) {
    throw new TaskManagerValidationError("execution_result.output_manifest must be an object");
  }
  return {
    process_started: value.process_started,
    process_exit_code: value.process_exit_code === undefined ? null : value.process_exit_code,
    command_success: value.command_success,
    required_outputs: normalizeRequiredOutputPaths(value.required_outputs ?? []),
    verified_outputs: normalizeRequiredOutputPaths(value.verified_outputs ?? []),
    missing_outputs: normalizeRequiredOutputPaths(value.missing_outputs ?? []),
    output_manifest: resultIntegrity(value.output_manifest),
    error_code: value.error_code === null || value.error_code === undefined
      ? null
      : text(value.error_code, "execution_result.error_code", true, 200),
    retryable: value.retryable,
  };
}

function enforceCompletionContract(task: TaskRecord): TaskRecord {
  if (task.status !== "DONE" && task.status !== "COMPLETED") return task;
  if (task.result_manifest.required_outputs.length === 0) return task;
  const executionResult = buildExecutionResult(task);
  const contractFailed = completionContractFailure(executionResult);
  const guarded: TaskRecord = {
    ...task,
    result_manifest: {
      ...task.result_manifest,
      integrity: executionResult.output_manifest,
      execution_result: executionResult,
      review_status: contractFailed ? "NOT_READY" : "READY",
    },
  };
  if (contractFailed) {
    guarded.status = "FAILED";
    guarded.progress = Math.min(guarded.progress, 99);
    guarded.stage = "执行失败";
    guarded.current_action = "输出校验失败";
    guarded.next_action = "检查输出并重试";
    guarded.last_error = completionFailureMessage(executionResult);
  } else {
    guarded.output_files = [...new Set([
      ...guarded.output_files,
      ...executionResult.verified_outputs,
    ])];
  }
  return guarded;
}

function checkKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new TaskManagerValidationError("unsupported task field: " + unknown);
  }
}

function aliasedValue(
  value: Record<string, unknown>,
  canonical: string,
  legacy?: string,
): unknown {
  const hasCanonical = canonical in value;
  const hasLegacy = legacy !== undefined && legacy in value;
  if (hasCanonical && hasLegacy && value[canonical] !== value[legacy!]) {
    throw new TaskManagerValidationError(
      canonical + " conflicts with compatibility field " + legacy,
    );
  }
  return hasCanonical ? value[canonical] : hasLegacy ? value[legacy!] : undefined;
}

function eventType(value: unknown): TaskEventType {
  if (typeof value !== "string" || !TASK_EVENT_TYPES.includes(value as TaskEventType)) {
    throw new TaskManagerValidationError(
      "type must be one of: " + TASK_EVENT_TYPES.join(", "),
    );
  }
  return value as TaskEventType;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TaskManagerValidationError(field + " must be a non-negative integer");
  }
  return value;
}

function eventPayload(value: unknown): TaskEventPayload {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("payload must be a JSON object");
  }
  checkKeys(value, [
    "message",
    "stage",
    "phase",
    "progress",
    "progress_percent",
    "source",
    "item",
    "current_action",
    "current_item",
    "next_action",
    "next_step",
    "status",
    "completed_count",
    "total_count",
    "output_files",
    "output_directories",
    "result_summary",
  ]);
  const result: TaskEventPayload = {};
  const stageValue = aliasedValue(value, "stage", "phase");
  const progressValue = aliasedValue(value, "progress", "progress_percent");
  const currentActionValue = aliasedValue(value, "current_action", "current_item");
  const nextActionValue = aliasedValue(value, "next_action", "next_step");
  if ("message" in value) result.message = text(value.message, "payload.message");
  if (stageValue !== undefined) result.stage = text(stageValue, "payload.stage");
  if (progressValue !== undefined) result.progress = progress(progressValue, "payload.progress");
  if ("source" in value) result.source = text(value.source, "payload.source", false, 100);
  if ("item" in value) result.item = text(value.item, "payload.item");
  if (currentActionValue !== undefined) {
    result.current_action = text(currentActionValue, "payload.current_action");
  }
  if (nextActionValue !== undefined) {
    result.next_action = text(nextActionValue, "payload.next_action");
  }
  if ("status" in value) result.status = status(value.status, "payload.status");
  if ("completed_count" in value) {
    result.completed_count = nonNegativeInteger(value.completed_count, "payload.completed_count");
  }
  if ("total_count" in value) {
    result.total_count = nonNegativeInteger(value.total_count, "payload.total_count");
  }
  if ("output_files" in value) {
    result.output_files = outputFiles(value.output_files);
  }
  if ("output_directories" in value) {
    result.output_directories = outputDirectories(value.output_directories);
  }
  if ("result_summary" in value) {
    result.result_summary = text(
      value.result_summary,
      "payload.result_summary",
      true,
      MAX_RESULT_SUMMARY_CHARS,
    );
  }
  return result;
}

function validateTask(value: unknown): TaskRecord {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("task record must be an object");
  }
  const taskStatus = status(value.status);
  const taskProgress = progress(value.progress);
  if ((taskStatus === "DONE" || taskStatus === "COMPLETED") && taskProgress !== 100) {
    throw new TaskManagerValidationError("completed tasks must have progress 100");
  }
  const task: Omit<TaskRecord, "result_manifest"> = {
    id: text(value.id, "id", false, MAX_TASK_ID),
    fingerprint: text(value.fingerprint, "fingerprint", false, MAX_FINGERPRINT_CHARS),
    name: text(value.name, "name", false),
    type: text(value.type, "type"),
    execution_source: inferredExecutionSource(value),
    account: text(value.account, "account"),
    skill: text(value.skill, "skill"),
    status: taskStatus,
    progress: taskProgress,
    stage: text(value.stage, "stage"),
    current_action: text(value.current_action, "current_action"),
    next_action: text(value.next_action, "next_action"),
    completed_items: completedItems(value.completed_items),
    output_files: outputFiles(value.output_files),
    output_directories: outputDirectories(value.output_directories),
    result_summary: text(
      value.result_summary,
      "result_summary",
      true,
      MAX_RESULT_SUMMARY_CHARS,
    ),
    final_answer: text(value.final_answer ?? "", "final_answer", true, MAX_FINAL_ANSWER_CHARS),
    worker_id: value.worker_id === null ? null : nullableText(value.worker_id, "worker_id", MAX_WORKER_ID_CHARS),
    thread_id: value.thread_id === null ? null : nullableText(value.thread_id, "thread_id", MAX_TASK_ID),
    turn_id: value.turn_id === null ? null : nullableText(value.turn_id, "turn_id", MAX_TASK_ID),
    cwd: text(value.cwd, "cwd", true, MAX_CWD_CHARS),
    write_claims: writeClaims(value.write_claims),
    started_at: value.started_at === null ? null : nullableText(value.started_at, "started_at", 100),
    completed_at: value.completed_at === null ? null : nullableText(value.completed_at, "completed_at", 100),
    retry_count: nonNegativeInteger(value.retry_count, "retry_count"),
    last_error: value.last_error === null ? null : nullableText(value.last_error, "last_error", MAX_LAST_ERROR_CHARS),
    created_at: text(value.created_at, "created_at", false, 100),
    updated_at: text(value.updated_at, "updated_at", false, 100),
  };
  return {
    ...task,
    result_manifest: resultManifest(value.result_manifest, task),
  };
}

function statusAfterEvent(
  current: TaskLifecycle,
  type: TaskEventType,
  payload: TaskEventPayload,
): TaskLifecycle {
  if (payload.status) {
    return payload.status;
  }
  switch (type) {
    case "task.waiting":
      return "WAITING";
    case "task.started":
    case "task.confirmed":
    case "task.resumed":
    case "TASK_STARTED":
      return "RUNNING";
    case "task.progressed":
    case "task.item_completed":
    case "STAGE_CHANGED":
    case "PROGRESS_UPDATED":
    case "FILE_FOUND":
    case "FILE_PROCESSED":
      return current === "WAITING" ? "RUNNING" : current;
    case "task.needs_confirmation":
    case "WAITING_CONFIRM":
      return "NEED_CONFIRM";
    case "task.paused":
      return "PAUSED";
    case "task.completed":
    case "TASK_COMPLETED":
      return "DONE";
    case "task.failed":
    case "task.cancelled":
    case "ERROR":
      return "FAILED";
    case "task.created":
    case "task.updated":
    case "TASK_CREATED":
      return current;
  }
}

function validateEvent(value: unknown): TaskEvent {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("task event must be an object");
  }
  const payload = eventPayload(value.payload);
  return {
    event_id: text(value.event_id, "event.event_id", false, MAX_TASK_ID),
    task_id: text(value.task_id, "event.task_id", false, MAX_TASK_ID),
    type: eventType(value.type),
    at: text(value.at, "event.at", false, 100),
    status: status(value.status, "event.status"),
    payload,
  };
}

function migrateLegacyTask(value: unknown): TaskRecord {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("legacy task record must be an object");
  }
  const migratedStatus = status(value.status);
  const legacyId = text(value.task_id, "task_id", false, MAX_TASK_ID);
  return validateTask({
    id: legacyId,
    fingerprint: "legacy:" + legacyId,
    name: value.task_name,
    type: "通用任务",
    account: "",
    skill: "",
    status: migratedStatus,
    progress: migratedStatus === "DONE" ? 100 : value.progress_percent,
    stage: value.phase,
    current_action: value.current_item,
    next_action: value.next_step,
    completed_items: value.completed_items,
    output_files: [],
    output_directories: [],
    result_summary: "",
    worker_id: null,
    thread_id: null,
    turn_id: null,
    cwd: "",
    write_claims: [],
    started_at: null,
    completed_at: migratedStatus === "DONE" ? value.updated_at : null,
    retry_count: 0,
    last_error: null,
    created_at: value.created_at,
    updated_at: value.updated_at,
  });
}

function migrateV3Task(value: unknown): TaskRecord {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("schema v3 task record must be an object");
  }
  return validateTask({
    ...value,
    fingerprint: value.fingerprint ?? "legacy-v3:" + text(value.id, "id", false, MAX_TASK_ID),
    output_files: [],
    output_directories: [],
    result_summary: "",
    worker_id: null,
    thread_id: null,
    turn_id: null,
    cwd: "",
    write_claims: [],
    started_at: null,
    completed_at: value.status === "DONE" ? value.updated_at : null,
    retry_count: 0,
    last_error: null,
  });
}

function migrateV4Task(value: unknown): TaskRecord {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("schema v4 task record must be an object");
  }
  return validateTask({
    ...value,
    fingerprint: value.fingerprint ?? "legacy-v4:" + text(value.id, "id", false, MAX_TASK_ID),
    output_directories: value.output_directories ?? [],
    worker_id: value.worker_id ?? null,
    thread_id: value.thread_id ?? null,
    turn_id: value.turn_id ?? null,
    cwd: value.cwd ?? "",
    write_claims: value.write_claims ?? [],
    started_at: value.started_at ?? null,
    completed_at: value.completed_at ?? null,
    retry_count: value.retry_count ?? 0,
    last_error: value.last_error ?? null,
  });
}

function migrateLegacyEvents(value: unknown, tasks: readonly TaskRecord[]): TaskEvent[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TaskManagerValidationError("events must be an array");
  }
  const currentByTask = new Map<string, TaskLifecycle>();
  for (const task of tasks) {
    currentByTask.set(task.id, "WAITING");
  }
  return value.slice(-MAX_EVENTS).map((candidate) => {
    if (!isRecord(candidate)) {
      throw new TaskManagerValidationError("task event must be an object");
    }
    const taskId = text(candidate.task_id, "event.task_id", false, MAX_TASK_ID);
    const type = eventType(candidate.type);
    const payload = eventPayload(candidate.payload);
    if (type === "task.cancelled" && payload.message === undefined) {
      payload.message = "旧版 cancelled 状态已迁移为 FAILED";
    }
    const eventStatus = statusAfterEvent(currentByTask.get(taskId) ?? "WAITING", type, payload);
    currentByTask.set(taskId, eventStatus);
    return {
      event_id: text(candidate.event_id, "event.event_id", false, MAX_TASK_ID),
      task_id: taskId,
      type,
      at: text(candidate.at, "event.at", false, 100),
      status: eventStatus,
      payload,
    };
  });
}

function migrateV6Task(value: unknown): TaskRecord {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("schema v6 task record must be an object");
  }
  return validateTask({
    ...value,
    result_manifest: value.result_manifest ?? undefined,
  });
}

function migrateV5Task(value: unknown): TaskRecord {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("schema v5 task record must be an object");
  }
  return validateTask({
    ...value,
    output_directories: value.output_directories ?? [],
  });
}

function validateV7Snapshot(value: Record<string, unknown>): TaskManagerSnapshot {
  if (!Array.isArray(value.tasks) || value.tasks.length > MAX_TASKS) {
    throw new TaskManagerValidationError(
      "tasks must be an array with at most " + MAX_TASKS + " records",
    );
  }
  const tasks = value.tasks.map(validateTask);
  const events = value.events === undefined
    ? []
    : Array.isArray(value.events)
      ? value.events.slice(-MAX_EVENTS).map(validateEvent)
      : (() => {
          throw new TaskManagerValidationError("events must be an array");
        })();
  return validateSnapshotParts(value.active_task_id, tasks, events, value.updated_at);
}

function validateSnapshotParts(
  activeTaskId: unknown,
  tasks: TaskRecord[],
  events: TaskEvent[],
  updatedAt: unknown,
): TaskManagerSnapshot {
  if (
    activeTaskId !== null &&
    (typeof activeTaskId !== "string" || activeTaskId.length === 0)
  ) {
    throw new TaskManagerValidationError("active_task_id must be null or a non-empty string");
  }
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new TaskManagerValidationError("task id values must be unique");
    }
    ids.add(task.id);
    if (fingerprints.has(task.fingerprint)) {
      throw new TaskManagerValidationError("task fingerprint values must be unique");
    }
    fingerprints.add(task.fingerprint);
  }
  if (activeTaskId !== null && !ids.has(activeTaskId)) {
    throw new TaskManagerValidationError("active_task_id does not reference a task");
  }
  for (const event of events) {
    if (!ids.has(event.task_id)) {
      throw new TaskManagerValidationError("task event references a missing task");
    }
  }
  return {
    schema_version: TASK_MANAGER_SCHEMA_VERSION,
    active_task_id: activeTaskId,
    tasks,
    events,
    updated_at: text(updatedAt, "updated_at", false, 100),
  };
}

function loadSnapshot(value: unknown): LoadedSnapshot {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("task manager file must be an object");
  }
  if (value.schema_version === TASK_MANAGER_SCHEMA_VERSION) {
    return { snapshot: validateV7Snapshot(value), migratedFrom: null };
  }
  if (value.schema_version === PREVIOUS_TASK_MANAGER_SCHEMA_VERSION) {
    if (!Array.isArray(value.tasks) || value.tasks.length > MAX_TASKS) {
      throw new TaskManagerValidationError(
        "tasks must be an array with at most " + MAX_TASKS + " records",
      );
    }
    const tasks = value.tasks.map(migrateV6Task);
    const events = value.events === undefined
      ? []
      : Array.isArray(value.events)
        ? value.events.slice(-MAX_EVENTS).map(validateEvent)
        : (() => {
            throw new TaskManagerValidationError("events must be an array");
          })();
    return {
      snapshot: validateSnapshotParts(
        value.active_task_id,
        tasks,
        events,
        value.updated_at,
      ),
      migratedFrom: 6,
    };
  }
  if (value.schema_version === LEGACY_V5_TASK_MANAGER_SCHEMA_VERSION) {
    if (!Array.isArray(value.tasks) || value.tasks.length > MAX_TASKS) {
      throw new TaskManagerValidationError(
        "tasks must be an array with at most " + MAX_TASKS + " records",
      );
    }
    const tasks = value.tasks.map(migrateV5Task);
    const events = value.events === undefined
      ? []
      : Array.isArray(value.events)
        ? value.events.slice(-MAX_EVENTS).map(validateEvent)
        : (() => {
            throw new TaskManagerValidationError("events must be an array");
          })();
    return {
      snapshot: validateSnapshotParts(
        value.active_task_id,
        tasks,
        events,
        value.updated_at,
      ),
      migratedFrom: 5,
    };
  }
  if (value.schema_version === LEGACY_V4_TASK_MANAGER_SCHEMA_VERSION) {
    if (!Array.isArray(value.tasks) || value.tasks.length > MAX_TASKS) {
      throw new TaskManagerValidationError(
        "tasks must be an array with at most " + MAX_TASKS + " records",
      );
    }
    const tasks = value.tasks.map(migrateV4Task);
    const events = value.events === undefined
      ? []
      : Array.isArray(value.events)
        ? value.events.slice(-MAX_EVENTS).map(validateEvent)
        : (() => {
            throw new TaskManagerValidationError("events must be an array");
          })();
    return {
      snapshot: validateSnapshotParts(
        value.active_task_id,
        tasks,
        events,
        value.updated_at,
      ),
      migratedFrom: 4,
    };
  }
  if (value.schema_version === LEGACY_V3_TASK_MANAGER_SCHEMA_VERSION) {
    if (!Array.isArray(value.tasks) || value.tasks.length > MAX_TASKS) {
      throw new TaskManagerValidationError(
        "tasks must be an array with at most " + MAX_TASKS + " records",
      );
    }
    const tasks = value.tasks.map(migrateV3Task);
    const events = value.events === undefined
      ? []
      : Array.isArray(value.events)
        ? value.events.slice(-MAX_EVENTS).map(validateEvent)
        : (() => {
            throw new TaskManagerValidationError("events must be an array");
          })();
    return {
      snapshot: validateSnapshotParts(
        value.active_task_id,
        tasks,
        events,
        value.updated_at,
      ),
      migratedFrom: 3,
    };
  }
  if (value.schema_version === LEGACY_TASK_MANAGER_SCHEMA_VERSION) {
    if (!Array.isArray(value.tasks) || value.tasks.length > MAX_TASKS) {
      throw new TaskManagerValidationError(
        "tasks must be an array with at most " + MAX_TASKS + " records",
      );
    }
    const tasks = value.tasks.map(migrateLegacyTask);
    const events = migrateLegacyEvents(value.events, tasks);
    return {
      snapshot: validateSnapshotParts(
        value.active_task_id,
        tasks,
        events,
        value.updated_at,
      ),
      migratedFrom: 2,
    };
  }
  throw new TaskManagerValidationError("task manager file has an unsupported schema_version");
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    completed_items: [...task.completed_items],
    output_files: [...task.output_files],
    output_directories: [...task.output_directories],
    result_manifest: cloneResultManifest(task.result_manifest),
    write_claims: [...task.write_claims],
  };
}

function cloneResultManifest(manifest: ResultManifest): ResultManifest {
  return {
    ...manifest,
    output_files: [...manifest.output_files],
    output_directories: [...manifest.output_directories],
    required_outputs: [...(manifest.required_outputs ?? [])],
    ...(manifest.execution_result === undefined
      ? {}
      : {
          execution_result: {
            ...manifest.execution_result,
            required_outputs: [...manifest.execution_result.required_outputs],
            verified_outputs: [...manifest.execution_result.verified_outputs],
            missing_outputs: [...manifest.execution_result.missing_outputs],
            output_manifest: {
              ...manifest.execution_result.output_manifest,
              entries: manifest.execution_result.output_manifest.entries.map((entry) => ({ ...entry })),
              warnings: [...manifest.execution_result.output_manifest.warnings],
            },
          },
        }),
    warnings: [...manifest.warnings],
    integrity: {
      ...manifest.integrity,
      entries: manifest.integrity.entries.map((entry) => ({ ...entry })),
      warnings: [...manifest.integrity.warnings],
    },
  };
}

function cloneEvent(event: TaskEvent): TaskEvent {
  return {
    ...event,
    payload: {
      ...event.payload,
      ...(event.payload.output_files === undefined
        ? {}
        : { output_files: [...event.payload.output_files] }),
      ...(event.payload.output_directories === undefined
        ? {}
        : { output_directories: [...event.payload.output_directories] }),
    },
  };
}

function cloneSnapshot(snapshot: TaskManagerSnapshot): TaskManagerSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map(cloneTask),
    events: snapshot.events.map(cloneEvent),
  };
}

function defaultSnapshot(now: Date): TaskManagerSnapshot {
  return {
    schema_version: TASK_MANAGER_SCHEMA_VERSION,
    active_task_id: null,
    tasks: [],
    events: [],
    updated_at: now.toISOString(),
  };
}

function hasMeaningfulLegacyStatus(statusValue: LegacyTaskStatus): boolean {
  return (
    statusValue.task_name !== "暂无任务" ||
    statusValue.phase !== "等待任务状态" ||
    statusValue.progress_percent !== 0 ||
    statusValue.completed_items.length > 0 ||
    statusValue.current_item !== "暂无" ||
    statusValue.next_step !== "等待任务状态更新"
  );
}

const TASK_INPUT_KEYS = [
  "name",
  "task_name",
  "fingerprint",
  "type",
  "execution_source",
  "account",
  "skill",
  "status",
  "progress",
  "progress_percent",
  "stage",
  "phase",
  "current_action",
  "current_item",
  "next_action",
  "next_step",
  "completed_items",
  "output_files",
  "output_directories",
  "result_summary",
  "final_answer",
  "result_manifest",
  "worker_id",
  "thread_id",
  "turn_id",
  "cwd",
  "write_claims",
  "started_at",
  "completed_at",
  "retry_count",
  "last_error",
  "active",
] as const;

function validateCreateInput(value: unknown): Required<Omit<TaskCreateInput, "active" | "result_manifest">> &
  Pick<TaskCreateInput, "result_manifest"> & {
  active: boolean;
} {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("request body must be a JSON object");
  }
  checkKeys(value, TASK_INPUT_KEYS);
  const nameValue = aliasedValue(value, "name", "task_name");
  const progressValue = aliasedValue(value, "progress", "progress_percent");
  const stageValue = aliasedValue(value, "stage", "phase");
  const currentActionValue = aliasedValue(value, "current_action", "current_item");
  const nextActionValue = aliasedValue(value, "next_action", "next_step");
  const taskStatus = value.status === undefined ? "WAITING" : status(value.status);
  const taskProgress = progressValue === undefined
    ? taskStatus === "DONE" || taskStatus === "COMPLETED" ? 100 : 0
    : progress(progressValue);
  return {
    fingerprint: value.fingerprint === undefined
      ? "task:" + randomUUID()
      : text(value.fingerprint, "fingerprint", false, MAX_FINGERPRINT_CHARS),
    name: text(nameValue, "name", false),
    type: value.type === undefined ? "通用任务" : text(value.type, "type"),
    execution_source: inferredExecutionSource(value),
    account: value.account === undefined ? "" : text(value.account, "account"),
    skill: value.skill === undefined ? "" : text(value.skill, "skill"),
    status: taskStatus,
    progress: taskStatus === "DONE" || taskStatus === "COMPLETED" ? 100 : taskProgress,
    stage: stageValue === undefined ? "待开始" : text(stageValue, "stage"),
    current_action:
      currentActionValue === undefined ? "尚未开始" : text(currentActionValue, "current_action"),
    next_action:
      nextActionValue === undefined ? "等待开始" : text(nextActionValue, "next_action"),
    completed_items:
      value.completed_items === undefined ? [] : completedItems(value.completed_items),
    output_files: value.output_files === undefined ? [] : outputFiles(value.output_files),
    output_directories:
      value.output_directories === undefined ? [] : outputDirectories(value.output_directories),
    result_summary: value.result_summary === undefined
      ? ""
      : text(value.result_summary, "result_summary", true, MAX_RESULT_SUMMARY_CHARS),
    final_answer: value.final_answer === undefined
      ? ""
      : text(value.final_answer, "final_answer", true, MAX_FINAL_ANSWER_CHARS),
    ...(value.result_manifest === undefined
      ? {}
      : { result_manifest: value.result_manifest as ResultManifest }),
    worker_id: value.worker_id === undefined || value.worker_id === null
      ? null
      : text(value.worker_id, "worker_id", false, MAX_WORKER_ID_CHARS),
    thread_id: value.thread_id === undefined || value.thread_id === null
      ? null
      : text(value.thread_id, "thread_id", false, MAX_TASK_ID),
    turn_id: value.turn_id === undefined || value.turn_id === null
      ? null
      : text(value.turn_id, "turn_id", false, MAX_TASK_ID),
    cwd: value.cwd === undefined ? "" : text(value.cwd, "cwd", true, MAX_CWD_CHARS),
    write_claims: value.write_claims === undefined ? [] : writeClaims(value.write_claims),
    started_at: value.started_at === undefined || value.started_at === null
      ? null
      : text(value.started_at, "started_at", false, 100),
    completed_at: value.completed_at === undefined || value.completed_at === null
      ? null
      : text(value.completed_at, "completed_at", false, 100),
    retry_count: value.retry_count === undefined ? 0 : nonNegativeInteger(value.retry_count, "retry_count"),
    last_error: value.last_error === undefined || value.last_error === null
      ? null
      : text(value.last_error, "last_error", false, MAX_LAST_ERROR_CHARS),
    active: value.active === undefined ? false : booleanValue(value.active, "active"),
  };
}

function validateUpdateInput(value: unknown): TaskUpdateInput {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("request body must be a JSON object");
  }
  checkKeys(value, TASK_INPUT_KEYS);
  const result: TaskUpdateInput = {};
  const nameValue = aliasedValue(value, "name", "task_name");
  const progressValue = aliasedValue(value, "progress", "progress_percent");
  const stageValue = aliasedValue(value, "stage", "phase");
  const currentActionValue = aliasedValue(value, "current_action", "current_item");
  const nextActionValue = aliasedValue(value, "next_action", "next_step");
  if ("fingerprint" in value) result.fingerprint = text(value.fingerprint, "fingerprint", false, MAX_FINGERPRINT_CHARS);
  if (nameValue !== undefined) result.name = text(nameValue, "name", false);
  if ("type" in value) result.type = text(value.type, "type");
  if ("execution_source" in value) result.execution_source = executionSource(value.execution_source);
  if ("account" in value) result.account = text(value.account, "account");
  if ("skill" in value) result.skill = text(value.skill, "skill");
  if ("status" in value) result.status = status(value.status);
  if (progressValue !== undefined) result.progress = progress(progressValue);
  if (stageValue !== undefined) result.stage = text(stageValue, "stage");
  if (currentActionValue !== undefined) {
    result.current_action = text(currentActionValue, "current_action");
  }
  if (nextActionValue !== undefined) result.next_action = text(nextActionValue, "next_action");
  if ("completed_items" in value) result.completed_items = completedItems(value.completed_items);
  if ("output_files" in value) result.output_files = outputFiles(value.output_files);
  if ("output_directories" in value) {
    result.output_directories = outputDirectories(value.output_directories);
  }
  if ("result_summary" in value) {
    result.result_summary = text(
      value.result_summary,
      "result_summary",
      true,
      MAX_RESULT_SUMMARY_CHARS,
    );
  }
  if ("final_answer" in value) {
    result.final_answer = text(value.final_answer, "final_answer", true, MAX_FINAL_ANSWER_CHARS);
  }
  if ("result_manifest" in value) result.result_manifest = value.result_manifest as ResultManifest;
  if ("worker_id" in value) result.worker_id = value.worker_id === null
    ? null
    : text(value.worker_id, "worker_id", false, MAX_WORKER_ID_CHARS);
  if ("thread_id" in value) result.thread_id = value.thread_id === null
    ? null
    : text(value.thread_id, "thread_id", false, MAX_TASK_ID);
  if ("turn_id" in value) result.turn_id = value.turn_id === null
    ? null
    : text(value.turn_id, "turn_id", false, MAX_TASK_ID);
  if ("cwd" in value) result.cwd = text(value.cwd, "cwd", true, MAX_CWD_CHARS);
  if ("write_claims" in value) result.write_claims = writeClaims(value.write_claims);
  if ("started_at" in value) result.started_at = value.started_at === null
    ? null
    : text(value.started_at, "started_at", false, 100);
  if ("completed_at" in value) result.completed_at = value.completed_at === null
    ? null
    : text(value.completed_at, "completed_at", false, 100);
  if ("retry_count" in value) result.retry_count = nonNegativeInteger(value.retry_count, "retry_count");
  if ("last_error" in value) result.last_error = value.last_error === null
    ? null
    : text(value.last_error, "last_error", false, MAX_LAST_ERROR_CHARS);
  if ("active" in value) result.active = booleanValue(value.active, "active");
  if (result.status === "DONE" || result.status === "COMPLETED") {
    result.progress = 100;
  }
  return result;
}

export class TaskManager {
  readonly filePath: string;
  readonly #clock: () => Date;
  readonly #statusStore: { read: () => LegacyTaskStatus } | undefined;
  #snapshot: TaskManagerSnapshot;

  constructor(
    filePath: string,
    statusStore?: { read: () => LegacyTaskStatus },
    clock: () => Date = () => new Date(),
  ) {
    if (!isAbsolute(filePath)) {
      throw new Error("Task manager file path must be absolute");
    }
    this.filePath = resolve(filePath);
    this.#clock = clock;
    this.#statusStore = statusStore;
    try {
      const loaded = loadSnapshot(JSON.parse(readFileSync(this.filePath, "utf8")) as unknown);
      this.#snapshot = loaded.snapshot;
      if (loaded.migratedFrom !== null) {
        this.#backupLegacyFile(loaded.migratedFrom);
        this.#write(this.#snapshot);
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      this.#snapshot = defaultSnapshot(this.#clock());
      this.#write(this.#snapshot);
    }
    this.#migrateLegacyCurrentStatus();
  }

  snapshot(): TaskManagerSnapshot {
    return cloneSnapshot(this.#snapshot);
  }

  current(): TaskRecord | null {
    if (!this.#snapshot.active_task_id) {
      return null;
    }
    const task = this.#snapshot.tasks.find(
      (candidate) => candidate.id === this.#snapshot.active_task_id,
    );
    return task ? cloneTask(task) : null;
  }

  get(taskId: string): TaskRecord {
    return cloneTask(this.#find(taskId));
  }

  findByFingerprint(fingerprint: string): TaskRecord | null {
    const task = this.#snapshot.tasks.find((candidate) => candidate.fingerprint === fingerprint);
    return task ? cloneTask(task) : null;
  }

  findByThreadTurn(threadId: string, turnId: string): TaskRecord | null {
    const task = this.#snapshot.tasks.find(
      (candidate) => candidate.thread_id === threadId && candidate.turn_id === turnId,
    );
    return task ? cloneTask(task) : null;
  }

  unfinished(): TaskRecord[] {
    return this.#snapshot.tasks
      .filter((task) => !["DONE", "COMPLETED", "FAILED", "INTERRUPTED", "BLOCKED"].includes(task.status))
      .map(cloneTask);
  }

  create(value: unknown): TaskRecord {
    const input = validateCreateInput(value);
    if (this.#snapshot.tasks.length >= MAX_TASKS) {
      throw new TaskManagerValidationError("task manager has reached its record limit");
    }
    const duplicate = this.findByFingerprint(input.fingerprint);
    if (duplicate) {
      throw new TaskManagerValidationError("task fingerprint already exists: " + input.fingerprint);
    }
    const now = this.#clock().toISOString();
    const taskBase = {
      id: randomUUID(),
      fingerprint: input.fingerprint,
      name: input.name,
      type: input.type,
      execution_source: input.execution_source,
      account: input.account,
      skill: input.skill,
      status: input.status,
      progress: input.progress,
      stage: input.stage,
      current_action: input.current_action,
      next_action: input.next_action,
      completed_items: [...input.completed_items],
      output_files: [...input.output_files],
      output_directories: [...input.output_directories],
      result_summary: input.result_summary,
      final_answer: input.final_answer,
      worker_id: input.worker_id,
      thread_id: input.thread_id,
      turn_id: input.turn_id,
      cwd: input.cwd,
      write_claims: [...input.write_claims],
      started_at: input.started_at,
      completed_at: input.completed_at,
      retry_count: input.retry_count,
      last_error: input.last_error,
      created_at: now,
      updated_at: now,
    };
    const task: TaskRecord = {
      ...taskBase,
      result_manifest: resultManifest(input.result_manifest, taskBase),
    };
    const next = this.snapshot();
    next.tasks.push(task);
    if (input.active || next.active_task_id === null) {
      next.active_task_id = task.id;
    }
    this.#commit(
      next,
      this.#makeEvent(task.id, "task.created", {
        status: task.status,
        stage: task.stage,
        progress: task.progress,
        source: "task-manager",
      }, task.status, now),
    );
    return this.get(task.id);
  }

  update(taskId: string, value: unknown): TaskRecord {
    const patch = validateUpdateInput(value);
    const index = this.#snapshot.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) {
      throw new TaskNotFoundError(taskId);
    }
    const next = this.snapshot();
    const current = next.tasks[index];
    if (!current) {
      throw new TaskNotFoundError(taskId);
    }
    const { active, ...taskFields } = patch;
    let updated: TaskRecord = {
      ...current,
      ...taskFields,
      updated_at: this.#clock().toISOString(),
    };
    if (updated.status === "DONE" || updated.status === "COMPLETED") {
      updated.progress = 100;
    }
    if (updated.status === "RECOVERY_REQUIRED") {
      updated.progress = 0;
      updated.stage = "需要处理";
      updated.current_action = "任务无法自动恢复";
      updated.next_action = "结束任务或重新提交";
      updated.worker_id = null;
      updated.thread_id = null;
      updated.turn_id = null;
    }
    updated = enforceCompletionContract(updated);
    next.tasks[index] = updated;
    if (active === true) {
      next.active_task_id = taskId;
    } else if (active === false && next.active_task_id === taskId) {
      next.active_task_id = null;
    }
    this.#commit(next, this.#makeEvent(
      taskId,
      "task.updated",
      {
        status: updated.status,
        stage: updated.stage,
        progress: updated.progress,
        current_action: updated.current_action,
        next_action: updated.next_action,
        source: "task-manager",
      },
      updated.status,
      updated.updated_at,
    ));
    return this.get(taskId);
  }

  activate(taskId: string): TaskRecord {
    const task = this.#find(taskId);
    const next = this.snapshot();
    next.active_task_id = task.id;
    this.#commit(next, this.#makeEvent(taskId, "task.updated", {
      message: "任务已切换为当前任务",
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      source: "task-manager",
    }, task.status));
    return cloneTask(task);
  }

  eventsForTask(taskId: string, limit = 50): TaskEvent[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENTS) {
      throw new TaskManagerValidationError("event limit must be an integer from 1 to " + MAX_EVENTS);
    }
    this.#find(taskId);
    return this.#snapshot.events
      .filter((event) => event.task_id === taskId)
      .slice(-limit)
      .map(cloneEvent);
  }

  recordEvent(taskId: string, type: TaskEventType, payloadValue: unknown = {}): TaskEvent {
    const current = this.#find(taskId);
    let normalizedPayload = eventPayload(payloadValue);
    if (type === "task.cancelled" && normalizedPayload.message === undefined) {
      normalizedPayload.message = "任务已取消，按兼容终态记录为 FAILED";
    }
    const at = this.#clock().toISOString();
    const next = this.snapshot();
    const index = next.tasks.findIndex((task) => task.id === taskId);
    const patch = this.#statePatchForEvent(current, type, normalizedPayload);
    let updated: TaskRecord = {
      ...current,
      ...patch,
      updated_at: at,
    };
    if ((type === "task.started" || type === "TASK_STARTED") && updated.started_at === null) {
      updated.started_at = at;
    }
    if (["task.completed", "TASK_COMPLETED", "task.failed", "task.cancelled", "ERROR"].includes(type)
      && ["DONE", "COMPLETED", "FAILED", "INTERRUPTED"].includes(updated.status)
      && updated.completed_at === null) {
      updated.completed_at = at;
    }
    if (updated.status === "DONE") {
      updated.progress = 100;
    }
    let eventType = type;
    const attemptedCompletion = updated.status === "DONE" || updated.status === "COMPLETED";
    updated = enforceCompletionContract(updated);
    if (attemptedCompletion && updated.status === "FAILED") {
      normalizedPayload = {
        ...normalizedPayload,
        message: updated.last_error ?? "任务输出校验失败，任务未完成。",
        stage: updated.stage,
        current_action: updated.current_action,
        next_action: updated.next_action,
      };
      eventType = "ERROR";
    }
    next.tasks[index] = updated;
    const event = this.#makeEvent(taskId, eventType, {
      stage: updated.stage,
      progress: updated.progress,
      source: "runtime",
      ...normalizedPayload,
    }, updated.status, at);
    this.#commit(next, event);
    return cloneEvent(event);
  }

  updateCurrent(value: unknown): TaskRecord | null {
    const patch = validateUpdateInput(value);
    const current = this.current();
    const hasTaskFields = Object.keys(patch).length > 0;
    if (!hasTaskFields) {
      return current;
    }
    if (current) {
      return this.update(current.id, patch);
    }
    return this.create({
      ...patch,
      name: patch.name ?? "暂无任务",
      status: patch.status ?? "RUNNING",
      active: true,
    });
  }

  #find(taskId: string): TaskRecord {
    const task = this.#snapshot.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return task;
  }

  #statePatchForEvent(
    current: TaskRecord,
    type: TaskEventType,
    payload: TaskEventPayload,
  ): TaskUpdateInput {
    const shared: TaskUpdateInput = {};
    if (payload.stage !== undefined) shared.stage = payload.stage;
    if (payload.current_action !== undefined) shared.current_action = payload.current_action;
    if (payload.next_action !== undefined) shared.next_action = payload.next_action;
    if (payload.progress !== undefined) shared.progress = payload.progress;
    const nextStatus = statusAfterEvent(current.status, type, payload);
    switch (type) {
      case "task.item_completed":
      case "FILE_PROCESSED":
        return {
          ...shared,
          status: nextStatus,
          ...(payload.item
            ? { completed_items: [...current.completed_items, payload.item].slice(-MAX_COMPLETED_ITEMS) }
            : {}),
        };
      case "task.completed":
      case "TASK_COMPLETED":
        return {
          ...shared,
          status: "DONE",
          progress: 100,
          ...(payload.output_files === undefined
            ? {}
            : { output_files: [...payload.output_files] }),
          ...(payload.output_directories === undefined
            ? {}
            : { output_directories: [...payload.output_directories] }),
          ...(payload.result_summary === undefined
            ? {}
            : { result_summary: payload.result_summary }),
        };
      default:
        return { ...shared, status: nextStatus };
    }
  }

  #makeEvent(
    taskId: string,
    type: TaskEventType,
    payload: TaskEventPayload,
    eventStatus: TaskLifecycle,
    at = this.#clock().toISOString(),
  ): TaskEvent {
    return {
      event_id: randomUUID(),
      task_id: taskId,
      type,
      at,
      status: eventStatus,
      payload: { ...payload },
    };
  }

  #commit(next: TaskManagerSnapshot, event?: TaskEvent): void {
    if (event) {
      next.events = [...next.events, event].slice(-MAX_EVENTS);
    }
    next.updated_at = this.#clock().toISOString();
    this.#snapshot = loadSnapshot(next).snapshot;
    this.#write(this.#snapshot);
  }

  #migrateLegacyCurrentStatus(): void {
    if (this.#snapshot.tasks.length > 0 || !this.#statusStore) {
      return;
    }
    const legacy = this.#statusStore.read();
    if (!hasMeaningfulLegacyStatus(legacy)) {
      return;
    }
    const legacyLifecycle: TaskLifecycle = legacy.progress_percent >= 100 ? "DONE" : "RUNNING";
    const taskBase = {
      id: "legacy-current",
      fingerprint: "legacy-current",
      name: legacy.task_name,
      type: "通用任务",
      execution_source: "external/native" as const,
      account: "",
      skill: "",
      status: legacyLifecycle,
      progress: legacyLifecycle === "DONE" ? 100 : legacy.progress_percent,
      stage: legacy.phase,
      current_action: legacy.current_item,
      next_action: legacy.next_step,
      completed_items: [...legacy.completed_items],
      output_files: [],
      output_directories: [],
      result_summary: "",
      final_answer: "",
      worker_id: null,
      thread_id: null,
      turn_id: null,
      cwd: "",
      write_claims: [],
      started_at: legacy.updated_at,
      completed_at: legacy.progress_percent >= 100 ? legacy.updated_at : null,
      retry_count: 0,
      last_error: null,
      created_at: legacy.updated_at,
      updated_at: legacy.updated_at,
    };
    const task: TaskRecord = {
      ...taskBase,
      result_manifest: resultManifest(undefined, taskBase),
    };
    const next = this.snapshot();
    next.active_task_id = task.id;
    next.tasks.push(task);
    this.#commit(next, this.#makeEvent(
      task.id,
      "task.created",
      {
        message: "从旧版任务状态迁移",
        status: task.status,
        stage: task.stage,
        progress: task.progress,
        source: "task-manager",
      },
      task.status,
      legacy.updated_at,
    ));
  }

  #backupLegacyFile(schemaVersion: 2 | 3 | 4 | 5 | 6): void {
    const backupPath = this.filePath + ".schema" + schemaVersion + ".bak";
    try {
      copyFileSync(this.filePath, backupPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  #write(snapshot: TaskManagerSnapshot): void {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const temporary = this.filePath + "." + process.pid + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temporary, JSON.stringify(snapshot, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
      });
      renameSync(temporary, this.filePath);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  endRecovery(taskId: string, reason = "用户结束了无法恢复的任务"): TaskRecord {
    const task = this.#find(taskId);
    if (task.status !== "RECOVERY_REQUIRED") {
      throw new TaskManagerValidationError("only recovery-required tasks can be ended");
    }
    return this.update(taskId, {
      status: "INTERRUPTED",
      progress: 0,
      stage: "已中断",
      current_action: "任务已中断",
      next_action: "无",
      completed_at: task.completed_at ?? this.#clock().toISOString(),
      worker_id: null,
      thread_id: null,
      turn_id: null,
      last_error: reason,
      active: false,
    });
  }
}

/**
 * Read a task-manager snapshot without constructing a TaskManager or writing
 * migrations/default state. This is used by read-only cross-process status
 * projections (for example, the V6 plugin child owned by the Tunnel).
 */
export function readTaskManagerSnapshot(filePath: string): TaskManagerSnapshot | null {
  if (!isAbsolute(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(resolve(filePath), "utf8")) as unknown;
    return cloneSnapshot(loadSnapshot(parsed).snapshot);
  } catch {
    return null;
  }
}

export function resolveTaskManagerFile(
  environment: NodeJS.ProcessEnv = process.env,
  currentDirectory = process.cwd(),
): string {
  const configured = environment[TASK_MANAGER_FILE_ENV]?.trim();
  if (configured) {
    const hasControlCharacter =
      configured.includes(String.fromCharCode(0)) ||
      configured.includes(String.fromCharCode(13)) ||
      configured.includes(String.fromCharCode(10));
    if (hasControlCharacter || !isAbsolute(configured)) {
      throw new Error(TASK_MANAGER_FILE_ENV + " must be an absolute path without control characters");
    }
    return resolve(configured);
  }
  const localAppData = environment.LOCALAPPDATA?.trim();
  if (localAppData && isAbsolute(localAppData)) {
    return join(localAppData, "LocalCodexBridge", "task_records.json");
  }
  return join(currentDirectory, "task_records.json");
}
