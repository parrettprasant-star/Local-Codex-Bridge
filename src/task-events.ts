import {
  TASK_EVENT_STREAM_TYPES,
  TaskManager,
  TaskManagerValidationError,
  type TaskEvent as StoredTaskEvent,
  type TaskEventPayload,
  type TaskEventType as StoredTaskEventType,
} from "./task-manager.js";
import { TaskRuntime, type ReportProgressInput } from "./task-runtime.js";

export const TASK_EVENT_TYPES = TASK_EVENT_STREAM_TYPES;

export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export interface TaskEvent {
  id: string;
  task_id: string;
  timestamp: string;
  type: TaskEventType;
  stage: string;
  message: string;
  progress: number;
  source: string;
}

export interface TaskEventListOptions {
  taskId?: string;
  limit?: number;
}

export interface TaskEventList {
  events: TaskEvent[];
  total: number;
}

interface TaskEventInput {
  taskId: string;
  type?: TaskEventType;
  stage?: string;
  message?: string;
  progress?: number;
  source: string;
  outputFiles?: string[];
  outputDirectories?: string[];
  resultSummary?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(
  value: unknown,
  field: string,
  maximum: number,
  allowEmpty = true,
): string {
  if (typeof value !== "string") {
    throw new TaskManagerValidationError(field + " must be a string");
  }
  if (!allowEmpty && value.length === 0) {
    throw new TaskManagerValidationError(field + " must not be empty");
  }
  if (value.length > maximum) {
    throw new TaskManagerValidationError(
      field + " must be at most " + maximum + " characters",
    );
  }
  return value;
}

function publicType(event: StoredTaskEvent): TaskEventType {
  if ((TASK_EVENT_TYPES as readonly string[]).includes(event.type)) {
    return event.type as TaskEventType;
  }
  switch (event.type) {
    case "task.created":
      return "TASK_CREATED";
    case "task.started":
    case "task.confirmed":
    case "task.resumed":
      return "TASK_STARTED";
    case "task.updated":
    case "task.waiting":
    case "task.paused":
      return "STAGE_CHANGED";
    case "task.progressed":
      return "PROGRESS_UPDATED";
    case "task.needs_confirmation":
      return "WAITING_CONFIRM";
    case "task.item_completed":
      return "FILE_PROCESSED";
    case "task.failed":
    case "task.cancelled":
      return "ERROR";
    case "task.completed":
      return "TASK_COMPLETED";
    default:
      throw new TaskManagerValidationError("unsupported stored event type: " + event.type);
  }
}

export function toTaskEventView(event: StoredTaskEvent): TaskEvent {
  const payload = event.payload;
  return {
    id: event.event_id,
    task_id: event.task_id,
    timestamp: event.at,
    type: publicType(event),
    stage: payload.stage ?? "",
    message: payload.message ?? payload.current_action ?? payload.item ?? "",
    progress: payload.progress ?? (event.status === "DONE" ? 100 : 0),
    source: payload.source ?? "bridge",
  };
}

interface DeduplicableTaskEvent {
  task_id: string;
  type: string;
  stage: string;
  message: string;
  progress: number;
  source: string;
}

export function deduplicateTaskEventViews<T extends DeduplicableTaskEvent>(events: readonly T[]): T[] {
  const result: T[] = [];
  let previousKey = "";
  for (const event of events) {
    const key = JSON.stringify([
      event.task_id,
      event.type,
      event.stage,
      event.message,
      event.progress,
      event.source,
    ]);
    if (key === previousKey && (event.type === "STAGE_CHANGED" || event.type === "TASK_COMPLETED")) {
      continue;
    }
    result.push(event);
    previousKey = key;
  }
  return result;
}

function validateLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 500) {
    throw new TaskManagerValidationError("event limit must be an integer from 1 to 500");
  }
  return value;
}

export class TaskEventStream {
  readonly #manager: TaskManager;
  readonly #runtime: TaskRuntime;

  constructor(manager: TaskManager, runtime: TaskRuntime) {
    this.#manager = manager;
    this.#runtime = runtime;
  }

  list(options: TaskEventListOptions = {}): TaskEventList {
    const limit = validateLimit(options.limit ?? 50);
    let events = this.#manager.snapshot().events;
    if (options.taskId !== undefined) {
      const taskId = boundedText(options.taskId, "task_id", 100, false);
      this.#manager.get(taskId);
      events = events.filter((event) => event.task_id === taskId);
    }
    return {
      events: deduplicateTaskEventViews(events.slice(-limit).map(toTaskEventView)),
      total: events.length,
    };
  }

  record(value: unknown): TaskEvent {
    const input = this.#validateInput(value);
    let stored: StoredTaskEvent;
    if (input.type === undefined) {
      const report: ReportProgressInput = {
        stage: input.stage!,
        progress: input.progress!,
        source: input.source,
      };
      if (input.message !== undefined) {
        report.message = input.message;
      }
      stored = this.#runtime.reportProgress(input.taskId, report);
    } else {
      const payload: TaskEventPayload = { source: input.source };
      if (input.stage !== undefined) payload.stage = input.stage;
      if (input.message !== undefined) {
        payload.message = input.message;
        payload.current_action = input.message;
      }
      if (input.progress !== undefined) payload.progress = input.progress;
      if (input.outputFiles !== undefined) payload.output_files = input.outputFiles;
      if (input.outputDirectories !== undefined) {
        payload.output_directories = input.outputDirectories;
      }
      if (input.resultSummary !== undefined) payload.result_summary = input.resultSummary;
      stored = this.#runtime.emit(input.taskId, { type: input.type, payload });
    }
    return toTaskEventView(stored);
  }

  #validateInput(value: unknown): TaskEventInput {
    if (!isRecord(value)) {
      throw new TaskManagerValidationError("event request must be a JSON object");
    }
    const allowed = new Set([
      "task_id",
      "type",
      "stage",
      "message",
      "progress",
      "source",
      "output_files",
      "output_directories",
      "result_summary",
    ]);
    const unknown = Object.keys(value).find((key) => !allowed.has(key));
    if (unknown) {
      throw new TaskManagerValidationError("unsupported event field: " + unknown);
    }

    let taskId: string;
    if ("task_id" in value) {
      taskId = boundedText(value.task_id, "task_id", 100, false);
    } else {
      const current = this.#manager.current();
      if (!current) {
        throw new TaskManagerValidationError(
          "task_id is required when there is no active task",
        );
      }
      taskId = current.id;
    }

    const result: TaskEventInput = {
      taskId,
      source: "source" in value
        ? boundedText(value.source, "source", 100, false)
        : "api",
    };
    if ("type" in value) {
      if (
        typeof value.type !== "string" ||
        !(TASK_EVENT_TYPES as readonly string[]).includes(value.type)
      ) {
        throw new TaskManagerValidationError(
          "type must be one of: " + TASK_EVENT_TYPES.join(", "),
        );
      }
      result.type = value.type as TaskEventType;
    }
    if ("stage" in value) result.stage = boundedText(value.stage, "stage", 500);
    if ("message" in value) result.message = boundedText(value.message, "message", 500);
    if ("progress" in value) {
      if (
        typeof value.progress !== "number" ||
        !Number.isInteger(value.progress) ||
        value.progress < 0 ||
        value.progress > 100
      ) {
        throw new TaskManagerValidationError("progress must be an integer from 0 to 100");
      }
      result.progress = value.progress;
    }
    if ("output_files" in value) {
      if (!Array.isArray(value.output_files) || value.output_files.length > 50) {
        throw new TaskManagerValidationError(
          "output_files must be an array with at most 50 items",
        );
      }
      result.outputFiles = value.output_files.map((item, index) => {
        const output = boundedText(item, "output_files[" + index + "]", 1_000, false);
        if (/\r|\n|\0/.test(output)) {
          throw new TaskManagerValidationError(
            "output_files[" + index + "] must not contain control characters",
          );
        }
        return output;
      });
    }
    if ("output_directories" in value) {
      if (!Array.isArray(value.output_directories) || value.output_directories.length > 50) {
        throw new TaskManagerValidationError(
          "output_directories must be an array with at most 50 items",
        );
      }
      result.outputDirectories = value.output_directories.map((item, index) => {
        const output = boundedText(item, "output_directories[" + index + "]", 1_000, false);
        if (/\r|\n|\0/.test(output)) {
          throw new TaskManagerValidationError(
            "output_directories[" + index + "] must not contain control characters",
          );
        }
        return output;
      });
    }
    if ("result_summary" in value) {
      result.resultSummary = boundedText(value.result_summary, "result_summary", 500);
    }
    if (
      (result.outputFiles !== undefined || result.outputDirectories !== undefined || result.resultSummary !== undefined) &&
      result.type !== "TASK_COMPLETED"
    ) {
      throw new TaskManagerValidationError(
        "output_files, output_directories and result_summary are valid only for TASK_COMPLETED",
      );
    }
    if (result.type === undefined && (result.stage === undefined || result.progress === undefined)) {
      throw new TaskManagerValidationError(
        "reportProgress requires stage and progress when type is omitted",
      );
    }
    return result;
  }
}

export function isTaskEventType(value: unknown): value is TaskEventType {
  return typeof value === "string" && (TASK_EVENT_TYPES as readonly string[]).includes(value);
}

export type { StoredTaskEventType };
