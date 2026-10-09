import type { TaskLifecycle } from "./task-manager.js";

export const REVIEW_STATUSES = ["NOT_READY", "READY", "REVIEWED", "UNKNOWN", "LEGACY"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const RESULT_INTEGRITY_STATUSES = [
  "NOT_CHECKED",
  "PASS",
  "WARN",
  "FAILED",
  "UNVERIFIED",
  "ERROR",
] as const;
export type ResultIntegrityStatus = (typeof RESULT_INTEGRITY_STATUSES)[number];

export const RESULT_VERIFICATIONS = [
  "PASS",
  "MISSING",
  "ZERO_BYTE",
  "OUT_OF_SCOPE",
  "NOT_FILE",
  "NOT_DIRECTORY",
  "ERROR",
] as const;
export type ResultVerification = (typeof RESULT_VERIFICATIONS)[number];

export interface ResultIntegrityEntry {
  path: string;
  canonical_path: string | null;
  expected_type: "file" | "directory";
  actual_type: "file" | "directory" | "other" | "missing" | "unknown";
  verification: ResultVerification;
  exists: boolean;
  size_bytes: number | null;
  modified_at: string | null;
}

export interface ResultIntegrity {
  status: ResultIntegrityStatus;
  checked_at: string | null;
  files_declared: number;
  files_verified: number;
  directories_declared: number;
  directories_verified: number;
  recorded_output_count: number;
  declared_output_count: number | null;
  zero_byte_files: number;
  missing_paths: number;
  out_of_scope_paths: number;
  entries: ResultIntegrityEntry[];
  warnings: string[];
  error_summary: string | null;
}

export interface ExecutionResultContract {
  process_started: boolean;
  process_exit_code: number | null;
  command_success: boolean;
  required_outputs: string[];
  verified_outputs: string[];
  missing_outputs: string[];
  output_manifest: ResultIntegrity;
  error_code: string | null;
  retryable: boolean;
}

export interface ResultManifest {
  task_id: string;
  task_title: string;
  execution_status: TaskLifecycle;
  review_status: ReviewStatus;
  thread_id: string | null;
  last_turn_id: string | null;
  worker_id: string | null;
  workspace: string;
  cwd: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result_summary: string;
  output_files: string[];
  output_directories: string[];
  required_outputs: string[];
  execution_result?: ExecutionResultContract;
  warnings: string[];
  integrity: ResultIntegrity;
  resume_command: string | null;
}

export interface ResultManifestTaskFields {
  id: string;
  name: string;
  status: TaskLifecycle;
  thread_id: string | null;
  turn_id: string | null;
  worker_id: string | null;
  cwd: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result_summary: string;
  output_files: string[];
  output_directories: string[];
  required_outputs?: string[];
}

export function isTerminalExecutionStatus(status: TaskLifecycle): boolean {
  return ["DONE", "COMPLETED", "FAILED", "INTERRUPTED", "BLOCKED"].includes(status);
}

export function defaultReviewStatus(status: TaskLifecycle): ReviewStatus {
  return isTerminalExecutionStatus(status) ? "LEGACY" : "NOT_READY";
}

export function resumeCommand(threadId: string | null): string | null {
  return threadId ? "codex resume " + threadId : null;
}

export function defaultResultIntegrity(): ResultIntegrity {
  return {
    status: "NOT_CHECKED",
    checked_at: null,
    files_declared: 0,
    files_verified: 0,
    directories_declared: 0,
    directories_verified: 0,
    recorded_output_count: 0,
    declared_output_count: null,
    zero_byte_files: 0,
    missing_paths: 0,
    out_of_scope_paths: 0,
    entries: [],
    warnings: [],
    error_summary: null,
  };
}

export function defaultResultManifest(fields: ResultManifestTaskFields): ResultManifest {
  return {
    task_id: fields.id,
    task_title: fields.name,
    execution_status: fields.status,
    review_status: defaultReviewStatus(fields.status),
    thread_id: fields.thread_id,
    last_turn_id: fields.turn_id,
    worker_id: fields.worker_id,
    workspace: fields.cwd,
    cwd: fields.cwd,
    created_at: fields.created_at,
    started_at: fields.started_at,
    completed_at: fields.completed_at,
    result_summary: fields.result_summary,
    output_files: [...fields.output_files],
    output_directories: [...fields.output_directories],
    required_outputs: [...(fields.required_outputs ?? [])],
    warnings: [],
    integrity: defaultResultIntegrity(),
    resume_command: resumeCommand(fields.thread_id),
  };
}
