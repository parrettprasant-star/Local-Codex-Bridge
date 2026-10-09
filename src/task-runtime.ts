import {
  TASK_EVENT_TYPES,
  TaskManager,
  TaskManagerValidationError,
  type TaskEvent,
  type TaskEventPayload,
  type TaskEventType,
} from "./task-manager.js";

export interface TaskRuntimeEventInput {
  type: TaskEventType;
  payload?: TaskEventPayload;
}

export interface ReportProgressInput {
  stage: string;
  progress: number;
  message?: string;
  source?: string;
}

export type TaskRuntimeListener = (event: TaskEvent) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateReportProgress(value: unknown): ReportProgressInput {
  if (!isRecord(value)) {
    throw new TaskManagerValidationError("progress report must be a JSON object");
  }
  const allowed = new Set(["stage", "progress", "message", "source"]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new TaskManagerValidationError("unsupported progress field: " + unknown);
  }
  if (typeof value.stage !== "string" || value.stage.length === 0 || value.stage.length > 500) {
    throw new TaskManagerValidationError("stage must be a non-empty string of at most 500 characters");
  }
  if (
    typeof value.progress !== "number" ||
    !Number.isInteger(value.progress) ||
    value.progress < 0 ||
    value.progress > 100
  ) {
    throw new TaskManagerValidationError("progress must be an integer from 0 to 100");
  }
  const result: ReportProgressInput = {
    stage: value.stage,
    progress: value.progress,
  };
  if ("message" in value) {
    if (typeof value.message !== "string" || value.message.length > 500) {
      throw new TaskManagerValidationError("message must be a string of at most 500 characters");
    }
    result.message = value.message;
  }
  if ("source" in value) {
    if (
      typeof value.source !== "string" ||
      value.source.length === 0 ||
      value.source.length > 100
    ) {
      throw new TaskManagerValidationError(
        "source must be a non-empty string of at most 100 characters",
      );
    }
    result.source = value.source;
  }
  return result;
}

export class TaskRuntime {
  readonly #manager: TaskManager;
  readonly #listeners = new Set<TaskRuntimeListener>();

  constructor(manager: TaskManager) {
    this.#manager = manager;
  }

  emit(taskId: string, value: unknown): TaskEvent {
    if (!isRecord(value)) {
      throw new TaskManagerValidationError("event request must be a JSON object");
    }
    const type = value.type;
    if (typeof type !== "string" || !TASK_EVENT_TYPES.includes(type as TaskEventType)) {
      throw new TaskManagerValidationError(
        "type must be one of: " + TASK_EVENT_TYPES.join(", "),
      );
    }
    const event = this.#manager.recordEvent(
      taskId,
      type as TaskEventType,
      value.payload,
    );
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures must not undo the persisted task event.
      }
    }
    return event;
  }

  onEvent(listener: TaskRuntimeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(taskId: string, payload: TaskEventPayload = {}): TaskEvent {
    return this.emit(taskId, { type: "task.started", payload });
  }

  waiting(taskId: string, payload: TaskEventPayload = {}): TaskEvent {
    return this.emit(taskId, { type: "task.waiting", payload });
  }

  progress(taskId: string, payload: TaskEventPayload): TaskEvent {
    return this.emit(taskId, { type: "task.progressed", payload });
  }

  reportProgress(value: unknown): TaskEvent;
  reportProgress(taskId: string, value: unknown): TaskEvent;
  reportProgress(taskIdOrValue: unknown, maybeValue?: unknown): TaskEvent {
    let taskId: string;
    let value: unknown;
    if (typeof taskIdOrValue === "string") {
      taskId = taskIdOrValue;
      value = maybeValue;
    } else {
      const current = this.#manager.current();
      if (!current) {
        throw new TaskManagerValidationError(
          "reportProgress requires task_id when there is no active task",
        );
      }
      taskId = current.id;
      value = taskIdOrValue;
    }

    const report = validateReportProgress(value);
    const current = this.#manager.get(taskId);
    const payload: TaskEventPayload = {
      stage: report.stage,
      progress: report.progress,
      source: report.source ?? "runtime",
    };
    if (report.message !== undefined) {
      payload.message = report.message;
      payload.current_action = report.message;
    }
    return this.emit(taskId, {
      type: current.stage === report.stage ? "PROGRESS_UPDATED" : "STAGE_CHANGED",
      payload,
    });
  }

  itemCompleted(taskId: string, item: string, payload: TaskEventPayload = {}): TaskEvent {
    return this.emit(taskId, { type: "task.item_completed", payload: { ...payload, item } });
  }

  needsConfirmation(taskId: string, payload: TaskEventPayload = {}): TaskEvent {
    return this.emit(taskId, { type: "task.needs_confirmation", payload });
  }

  confirmed(taskId: string, payload: TaskEventPayload = {}): TaskEvent {
    return this.emit(taskId, { type: "task.confirmed", payload });
  }

  pause(taskId: string, payload: TaskEventPayload = {}): TaskEvent {
    return this.emit(taskId, { type: "task.paused", payload });
  }

  resume(taskId: string, payload: TaskEventPayload = {}): TaskEvent {
    return this.emit(taskId, { type: "task.resumed", payload });
  }

  complete(taskId: string, payload: TaskEventPayload = {}): TaskEvent {
    return this.emit(taskId, { type: "task.completed", payload });
  }

  fail(taskId: string, message?: string): TaskEvent {
    return this.emit(taskId, {
      type: "task.failed",
      payload: message === undefined ? {} : { message },
    });
  }
}
