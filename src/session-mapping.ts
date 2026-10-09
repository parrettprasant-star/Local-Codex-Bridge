import type { TaskRecord } from "./task-manager.js";

/** Durable task -> native Codex session projection. */
export interface SessionMapping {
  taskId: string;
  taskTitle: string;
  executionSource: TaskRecord["execution_source"];
  threadId: string | null;
  turnId: string | null;
  workerId: string | null;
  createdAt: string;
  updatedAt: string;
  status: TaskRecord["status"];
  cwd: string;
  outputFiles: string[];
  outputDirectories: string[];
  resultSummary: string;
}

export function sessionMapping(task: TaskRecord): SessionMapping {
  return {
    taskId: task.id,
    taskTitle: task.name,
    executionSource: task.execution_source,
    threadId: task.thread_id,
    turnId: task.turn_id,
    workerId: task.worker_id,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    status: task.status,
    cwd: task.cwd,
    outputFiles: [...task.output_files],
    outputDirectories: [...task.output_directories],
    resultSummary: task.result_summary,
  };
}
