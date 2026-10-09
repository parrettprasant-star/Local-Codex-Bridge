import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const TASK_STATUS_FILE_ENV = "LOCAL_CODEX_BRIDGE_STATUS_FILE";
export const TASK_STATUS_PORT_ENV = "LOCAL_CODEX_BRIDGE_STATUS_PORT";
export const DEFAULT_TASK_STATUS_PORT = 37_821;

const MAX_STATUS_TEXT = 500;
const MAX_BRIDGE_STATUS_TEXT = 100;
const MAX_COMPLETED_ITEMS = 100;

export interface TaskStatus {
  schema_version: 1;
  bridge_status: string;
  task_name: string;
  phase: string;
  progress_percent: number;
  completed_items: string[];
  current_item: string;
  next_step: string;
  updated_at: string;
}

export type TaskStatusPatch = Partial<
  Pick<
    TaskStatus,
    | "bridge_status"
    | "task_name"
    | "phase"
    | "progress_percent"
    | "completed_items"
    | "current_item"
    | "next_step"
  >
>;

export class TaskStatusValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskStatusValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function validateText(
  value: unknown,
  field: string,
  maximum: number,
  allowEmpty = true,
): string {
  if (typeof value !== "string") {
    throw new TaskStatusValidationError(`${field} must be a string`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new TaskStatusValidationError(`${field} must not be empty`);
  }
  if (value.length > maximum) {
    throw new TaskStatusValidationError(`${field} must be at most ${maximum} characters`);
  }
  return value;
}

function validateCompletedItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TaskStatusValidationError("completed_items must be an array of strings");
  }
  if (value.length > MAX_COMPLETED_ITEMS) {
    throw new TaskStatusValidationError(
      `completed_items must contain at most ${MAX_COMPLETED_ITEMS} items`,
    );
  }
  return value.map((item, index) =>
    validateText(item, `completed_items[${index}]`, MAX_STATUS_TEXT, false),
  );
}

function validateProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new TaskStatusValidationError("progress_percent must be an integer from 0 to 100");
  }
  return value;
}

function validateState(value: unknown): TaskStatus {
  if (!isRecord(value) || value.schema_version !== 1) {
    throw new TaskStatusValidationError("status file has an unsupported schema_version");
  }
  return {
    schema_version: 1,
    bridge_status: validateText(
      value.bridge_status,
      "bridge_status",
      MAX_BRIDGE_STATUS_TEXT,
      false,
    ),
    task_name: validateText(value.task_name, "task_name", MAX_STATUS_TEXT),
    phase: validateText(value.phase, "phase", MAX_STATUS_TEXT),
    progress_percent: validateProgress(value.progress_percent),
    completed_items: validateCompletedItems(value.completed_items),
    current_item: validateText(value.current_item, "current_item", MAX_STATUS_TEXT),
    next_step: validateText(value.next_step, "next_step", MAX_STATUS_TEXT),
    updated_at: validateText(value.updated_at, "updated_at", 100, false),
  };
}

function validatePatch(value: unknown): TaskStatusPatch {
  if (!isRecord(value)) {
    throw new TaskStatusValidationError("request body must be a JSON object");
  }
  const allowed = new Set([
    "bridge_status",
    "task_name",
    "phase",
    "progress_percent",
    "completed_items",
    "current_item",
    "next_step",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TaskStatusValidationError(`unsupported status field: ${unknown[0]}`);
  }

  const patch: TaskStatusPatch = {};
  if ("bridge_status" in value) {
    patch.bridge_status = validateText(
      value.bridge_status,
      "bridge_status",
      MAX_BRIDGE_STATUS_TEXT,
      false,
    );
  }
  if ("task_name" in value) {
    patch.task_name = validateText(value.task_name, "task_name", MAX_STATUS_TEXT);
  }
  if ("phase" in value) {
    patch.phase = validateText(value.phase, "phase", MAX_STATUS_TEXT);
  }
  if ("progress_percent" in value) {
    patch.progress_percent = validateProgress(value.progress_percent);
  }
  if ("completed_items" in value) {
    patch.completed_items = validateCompletedItems(value.completed_items);
  }
  if ("current_item" in value) {
    patch.current_item = validateText(value.current_item, "current_item", MAX_STATUS_TEXT);
  }
  if ("next_step" in value) {
    patch.next_step = validateText(value.next_step, "next_step", MAX_STATUS_TEXT);
  }
  return patch;
}

function defaultTaskStatus(now: Date): TaskStatus {
  return {
    schema_version: 1,
    bridge_status: "starting",
    task_name: "暂无任务",
    phase: "等待任务状态",
    progress_percent: 0,
    completed_items: [],
    current_item: "暂无",
    next_step: "等待任务状态更新",
    updated_at: now.toISOString(),
  };
}

export class TaskStatusStore {
  readonly filePath: string;
  readonly #clock: () => Date;
  #state: TaskStatus;

  constructor(filePath: string, clock: () => Date = () => new Date()) {
    if (!isAbsolute(filePath)) {
      throw new Error("Task status file path must be absolute");
    }
    this.filePath = resolve(filePath);
    this.#clock = clock;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      this.#state = validateState(JSON.parse(raw) as unknown);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      this.#state = defaultTaskStatus(this.#clock());
      this.#write(this.#state);
    }
  }

  read(): TaskStatus {
    return {
      ...this.#state,
      completed_items: [...this.#state.completed_items],
    };
  }

  update(value: unknown): TaskStatus {
    const patch = validatePatch(value);
    this.#state = validateState({
      ...this.#state,
      ...patch,
      updated_at: this.#clock().toISOString(),
    });
    this.#write(this.#state);
    return this.read();
  }

  setBridgeStatus(status: string): TaskStatus {
    return this.update({ bridge_status: status });
  }

  #write(state: TaskStatus): void {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      renameSync(temporary, this.filePath);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}

export function resolveTaskStatusFile(
  environment: NodeJS.ProcessEnv = process.env,
  currentDirectory = process.cwd(),
): string {
  const configured = environment[TASK_STATUS_FILE_ENV]?.trim();
  if (configured) {
    const hasControlCharacter =
      configured.includes(String.fromCharCode(0)) ||
      configured.includes(String.fromCharCode(13)) ||
      configured.includes(String.fromCharCode(10));
    if (hasControlCharacter || !isAbsolute(configured)) {
      throw new Error(`${TASK_STATUS_FILE_ENV} must be an absolute path without control characters`);
    }
    return resolve(configured);
  }
  const localAppData = environment.LOCALAPPDATA?.trim();
  if (localAppData && isAbsolute(localAppData)) {
    return join(localAppData, "LocalCodexBridge", "task_status.json");
  }
  return join(currentDirectory, "task_status.json");
}

export function resolveTaskStatusPort(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const configured = environment[TASK_STATUS_PORT_ENV]?.trim();
  if (!configured) {
    return DEFAULT_TASK_STATUS_PORT;
  }
  if (!/^\d+$/.test(configured)) {
    throw new Error(`${TASK_STATUS_PORT_ENV} must be an integer from 0 to 65535`);
  }
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${TASK_STATUS_PORT_ENV} must be an integer from 0 to 65535`);
  }
  return port;
}
