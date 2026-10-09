import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";

export const SERVICE_SESSION_FILE_ENV = "LOCAL_CODEX_BRIDGE_SERVICE_SESSIONS_FILE";
export const SERVICE_THREAD_MAX_TURNS_ENV = "LOCAL_CODEX_BRIDGE_SERVICE_THREAD_MAX_TURNS";
export const SERVICE_SESSION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_SERVICE_THREAD_MAX_TURNS = 8;

const MAX_SESSIONS = 50;
const MAX_ID_CHARS = 160;
const MAX_CWD_CHARS = 1_000;
const MAX_TASK_ID_CHARS = 100;
const MAX_REASON_CHARS = 500;
const MAX_CHECKPOINT_CHARS = 500;

export type ServiceSessionKind = "service" | "maintenance";
export type ServiceSessionStatus = "active" | "retired";

export interface ServiceSessionCheckpoint {
  completed_turns: number;
  last_completed_task_id: string | null;
  last_event: "created" | "turn_accepted" | "turn_completed" | "rotated";
}

export interface ServiceSessionRecord {
  session_id: string;
  kind: ServiceSessionKind;
  owner: "bridge-agent";
  status: ServiceSessionStatus;
  workspace: string;
  thread_id: string | null;
  generation: number;
  turn_count: number;
  last_task_id: string | null;
  rotation_reason: string | null;
  checkpoint: ServiceSessionCheckpoint;
  created_at: string;
  updated_at: string;
}

export interface ServiceSessionSnapshot {
  schema_version: typeof SERVICE_SESSION_SCHEMA_VERSION;
  sessions: ServiceSessionRecord[];
  updated_at: string;
}

export interface ServiceSessionPlan {
  session_id: string;
  kind: ServiceSessionKind;
  workspace: string;
  thread_id: string | null;
  mode: "start" | "resume";
  generation: number;
}

export interface ServiceSessionManagerOptions {
  maxTurns?: number;
  clock?: () => Date;
  ownerProcessId?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, field: string, maximum: number, allowNull = false): string | null {
  if (allowNull && value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${field} must be a non-empty string of at most ${maximum} characters`);
  }
  if (/\0|\r|\n/.test(value)) {
    throw new Error(`${field} must not contain control characters`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function positiveInteger(value: unknown, field: string): number {
  const result = nonNegativeInteger(value, field);
  if (result < 1) throw new Error(`${field} must be a positive integer`);
  return result;
}

function sessionKind(value: unknown): ServiceSessionKind {
  if (value !== "service" && value !== "maintenance") {
    throw new Error("service session kind must be service or maintenance");
  }
  return value;
}

function sessionStatus(value: unknown): ServiceSessionStatus {
  if (value !== "active" && value !== "retired") {
    throw new Error("service session status must be active or retired");
  }
  return value;
}

function normalizeWorkspace(value: string): string {
  if (value.includes("\0") || !/^[A-Za-z]:[\\/]/.test(value) || !win32.isAbsolute(value)) {
    throw new Error("service session workspace must be an absolute Windows drive-letter path");
  }
  return win32.normalize(value);
}

function keyFor(kind: ServiceSessionKind, workspace: string): string {
  return `${kind}:${workspace.toLowerCase()}`;
}

function stableSessionId(kind: ServiceSessionKind, workspace: string, generation: number): string {
  const digest = createHash("sha256")
    .update(`${kind}\0${workspace.toLowerCase()}\0${generation}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `bridge-${kind}-${digest}`;
}

function defaultCheckpoint(): ServiceSessionCheckpoint {
  return {
    completed_turns: 0,
    last_completed_task_id: null,
    last_event: "created",
  };
}

function cloneSession(session: ServiceSessionRecord): ServiceSessionRecord {
  return {
    ...session,
    checkpoint: { ...session.checkpoint },
  };
}

function cloneSnapshot(snapshot: ServiceSessionSnapshot): ServiceSessionSnapshot {
  return {
    schema_version: snapshot.schema_version,
    sessions: snapshot.sessions.map(cloneSession),
    updated_at: snapshot.updated_at,
  };
}

function validateCheckpoint(value: unknown): ServiceSessionCheckpoint {
  if (!isRecord(value)) throw new Error("service session checkpoint must be an object");
  const lastTask = value.last_completed_task_id === null || value.last_completed_task_id === undefined
    ? null
    : boundedText(value.last_completed_task_id, "checkpoint.last_completed_task_id", MAX_TASK_ID_CHARS, false);
  const lastEvent = value.last_event;
  if (!["created", "turn_accepted", "turn_completed", "rotated"].includes(String(lastEvent))) {
    throw new Error("checkpoint.last_event is invalid");
  }
  return {
    completed_turns: nonNegativeInteger(value.completed_turns, "checkpoint.completed_turns"),
    last_completed_task_id: lastTask,
    last_event: lastEvent as ServiceSessionCheckpoint["last_event"],
  };
}

function validateSession(value: unknown): ServiceSessionRecord {
  if (!isRecord(value)) throw new Error("service session must be an object");
  const workspace = normalizeWorkspace(String(boundedText(value.workspace, "workspace", MAX_CWD_CHARS)));
  const threadId = value.thread_id === null || value.thread_id === undefined
    ? null
    : boundedText(value.thread_id, "thread_id", MAX_ID_CHARS, false);
  const taskId = value.last_task_id === null || value.last_task_id === undefined
    ? null
    : boundedText(value.last_task_id, "last_task_id", MAX_TASK_ID_CHARS, false);
  const reason = value.rotation_reason === null || value.rotation_reason === undefined
    ? null
    : boundedText(value.rotation_reason, "rotation_reason", MAX_REASON_CHARS, false);
  if (value.owner !== "bridge-agent") throw new Error("service session owner must be bridge-agent");
  const turnCount = nonNegativeInteger(value.turn_count, "turn_count");
  const checkpoint = validateCheckpoint(value.checkpoint);
  if (checkpoint.completed_turns > turnCount) {
    throw new Error("checkpoint.completed_turns cannot exceed turn_count");
  }
  return {
    session_id: boundedText(value.session_id, "session_id", MAX_ID_CHARS, false) as string,
    kind: sessionKind(value.kind),
    owner: "bridge-agent",
    status: sessionStatus(value.status),
    workspace,
    thread_id: threadId,
    generation: nonNegativeInteger(value.generation, "generation"),
    turn_count: turnCount,
    last_task_id: taskId,
    rotation_reason: reason,
    checkpoint,
    created_at: boundedText(value.created_at, "created_at", 100, false) as string,
    updated_at: boundedText(value.updated_at, "updated_at", 100, false) as string,
  };
}

function defaultSnapshot(now: Date): ServiceSessionSnapshot {
  return {
    schema_version: SERVICE_SESSION_SCHEMA_VERSION,
    sessions: [],
    updated_at: now.toISOString(),
  };
}

function loadSnapshot(value: unknown): ServiceSessionSnapshot {
  if (!isRecord(value) || value.schema_version !== SERVICE_SESSION_SCHEMA_VERSION || !Array.isArray(value.sessions)) {
    throw new Error("unsupported service session store schema");
  }
  if (value.sessions.length > MAX_SESSIONS) throw new Error("service session store has too many sessions");
  return {
    schema_version: SERVICE_SESSION_SCHEMA_VERSION,
    sessions: value.sessions.map(validateSession),
    updated_at: boundedText(value.updated_at, "updated_at", 100, false) as string,
  };
}

function parseMaxTurns(environment: NodeJS.ProcessEnv): number {
  const configured = environment[SERVICE_THREAD_MAX_TURNS_ENV]?.trim();
  if (!configured) return DEFAULT_SERVICE_THREAD_MAX_TURNS;
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error(`${SERVICE_THREAD_MAX_TURNS_ENV} must be an integer from 1 to 50`);
  }
  return value;
}

export class ServiceSessionStore {
  readonly filePath: string;
  readonly #clock: () => Date;
  #snapshot: ServiceSessionSnapshot;

  constructor(filePath: string, clock: () => Date = () => new Date()) {
    if (!isAbsolute(filePath)) throw new Error("service session file path must be absolute");
    this.filePath = resolve(filePath);
    this.#clock = clock;
    try {
      this.#snapshot = loadSnapshot(JSON.parse(readFileSync(this.filePath, "utf8")) as unknown);
    } catch (error) {
      if (!(error instanceof Error) || !((error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
      this.#snapshot = defaultSnapshot(this.#clock());
      this.#write(this.#snapshot);
    }
  }

  snapshot(): ServiceSessionSnapshot {
    return cloneSnapshot(this.#snapshot);
  }

  list(): ServiceSessionRecord[] {
    return this.#snapshot.sessions.map(cloneSession);
  }

  find(kind: ServiceSessionKind, workspaceInput: string): ServiceSessionRecord | null {
    const workspace = normalizeWorkspace(workspaceInput);
    const key = keyFor(kind, workspace);
    const candidates = this.#snapshot.sessions
      .filter((session) => session.status === "active" && keyFor(session.kind, session.workspace) === key)
      .sort((left, right) => right.generation - left.generation || right.updated_at.localeCompare(left.updated_at));
    return candidates[0] ? cloneSession(candidates[0]) : null;
  }

  byThread(threadId: string): ServiceSessionRecord | null {
    const session = this.#snapshot.sessions.find((candidate) => candidate.thread_id === threadId);
    return session ? cloneSession(session) : null;
  }

  byId(sessionId: string): ServiceSessionRecord | null {
    const session = this.#snapshot.sessions.find((candidate) => candidate.session_id === sessionId);
    return session ? cloneSession(session) : null;
  }

  create(kind: ServiceSessionKind, workspaceInput: string, generation?: number): ServiceSessionRecord {
    const workspace = normalizeWorkspace(workspaceInput);
    const nextGeneration = generation ?? Math.max(
      -1,
      ...this.#snapshot.sessions
        .filter((session) => session.kind === kind && session.workspace.toLowerCase() === workspace.toLowerCase())
        .map((session) => session.generation),
    ) + 1;
    const now = this.#clock().toISOString();
    const session: ServiceSessionRecord = {
      session_id: stableSessionId(kind, workspace, nextGeneration),
      kind,
      owner: "bridge-agent",
      status: "active",
      workspace,
      thread_id: null,
      generation: nextGeneration,
      turn_count: 0,
      last_task_id: null,
      rotation_reason: null,
      checkpoint: defaultCheckpoint(),
      created_at: now,
      updated_at: now,
    };
    const next = cloneSnapshot(this.#snapshot);
    next.sessions = [...next.sessions.filter((candidate) => candidate.session_id !== session.session_id), session].slice(-MAX_SESSIONS);
    next.updated_at = now;
    this.#commit(next);
    return cloneSession(session);
  }

  bindThread(sessionId: string, threadId: string, taskId: string): ServiceSessionRecord {
    const index = this.#snapshot.sessions.findIndex((candidate) => candidate.session_id === sessionId);
    if (index < 0) throw new Error(`service session not found: ${sessionId}`);
    const normalizedThread = boundedText(threadId, "thread_id", MAX_ID_CHARS, false) as string;
    const normalizedTask = boundedText(taskId, "task_id", MAX_TASK_ID_CHARS, false) as string;
    const now = this.#clock().toISOString();
    const next = cloneSnapshot(this.#snapshot);
    const current = next.sessions[index];
    if (!current || current.status !== "active") throw new Error("cannot bind a retired service session");
    next.sessions[index] = {
      ...current,
      thread_id: normalizedThread,
      last_task_id: normalizedTask,
      updated_at: now,
      checkpoint: { ...current.checkpoint, last_event: "turn_accepted" },
    };
    next.updated_at = now;
    this.#commit(next);
    return cloneSession(next.sessions[index]);
  }

  markTurnAccepted(sessionId: string, taskId: string): ServiceSessionRecord {
    const session = this.#require(sessionId);
    const now = this.#clock().toISOString();
    const next = cloneSnapshot(this.#snapshot);
    const index = next.sessions.findIndex((candidate) => candidate.session_id === sessionId);
    next.sessions[index] = {
      ...session,
      turn_count: session.turn_count + 1,
      last_task_id: boundedText(taskId, "task_id", MAX_TASK_ID_CHARS, false) as string,
      updated_at: now,
      checkpoint: { ...session.checkpoint, last_event: "turn_accepted" },
    };
    next.updated_at = now;
    this.#commit(next);
    return cloneSession(next.sessions[index]);
  }

  markTurnCompleted(sessionId: string, taskId: string): ServiceSessionRecord {
    const session = this.#require(sessionId);
    const normalizedTask = boundedText(taskId, "task_id", MAX_TASK_ID_CHARS, false) as string;
    if (session.checkpoint.last_completed_task_id === normalizedTask) {
      return session;
    }
    const now = this.#clock().toISOString();
    const next = cloneSnapshot(this.#snapshot);
    const index = next.sessions.findIndex((candidate) => candidate.session_id === sessionId);
    next.sessions[index] = {
      ...session,
      last_task_id: normalizedTask,
      updated_at: now,
      checkpoint: {
        completed_turns: session.checkpoint.completed_turns + 1,
        last_completed_task_id: normalizedTask,
        last_event: "turn_completed",
      },
    };
    next.updated_at = now;
    this.#commit(next);
    return cloneSession(next.sessions[index]);
  }

  retire(sessionId: string, reason: string): ServiceSessionRecord {
    const session = this.#require(sessionId);
    const now = this.#clock().toISOString();
    const next = cloneSnapshot(this.#snapshot);
    const index = next.sessions.findIndex((candidate) => candidate.session_id === sessionId);
    next.sessions[index] = {
      ...session,
      status: "retired",
      rotation_reason: boundedText(reason, "rotation_reason", MAX_REASON_CHARS, false) as string,
      updated_at: now,
      checkpoint: { ...session.checkpoint, last_event: "rotated" },
    };
    next.updated_at = now;
    this.#commit(next);
    return cloneSession(next.sessions[index]);
  }

  #require(sessionId: string): ServiceSessionRecord {
    const session = this.#snapshot.sessions.find((candidate) => candidate.session_id === sessionId);
    if (!session) throw new Error(`service session not found: ${sessionId}`);
    return cloneSession(session);
  }

  #commit(next: ServiceSessionSnapshot): void {
    this.#snapshot = loadSnapshot(next);
    this.#write(this.#snapshot);
  }

  #write(snapshot: ServiceSessionSnapshot): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
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
}

export class ServiceSessionManager {
  readonly store: ServiceSessionStore | null;
  readonly maxTurns: number;
  readonly ownerProcessId: number;
  readonly #leases = new Map<string, string>();
  readonly #clock: () => Date;

  constructor(store: ServiceSessionStore | null = null, options: ServiceSessionManagerOptions = {}) {
    this.store = store;
    this.maxTurns = options.maxTurns ?? parseMaxTurns(process.env);
    if (!Number.isInteger(this.maxTurns) || this.maxTurns < 1 || this.maxTurns > 50) {
      throw new Error("service session maxTurns must be an integer from 1 to 50");
    }
    this.ownerProcessId = options.ownerProcessId ?? process.pid;
    this.#clock = options.clock ?? (() => new Date());
  }

  planForTask(workspaceInput: string, taskId: string): ServiceSessionPlan {
    return this.#planForKind("service", workspaceInput, taskId);
  }

  planMaintenance(workspaceInput: string, taskId: string): ServiceSessionPlan {
    return this.#planForKind("maintenance", workspaceInput, taskId);
  }

  rotate(
    kind: ServiceSessionKind,
    workspaceInput: string,
    taskId: string,
    reason: string,
  ): ServiceSessionPlan {
    const workspace = normalizeWorkspace(workspaceInput);
    const store = this.#requireStore();
    const existing = store.find(kind, workspace);
    if (existing && existing.status === "active") {
      store.retire(existing.session_id, reason);
      this.#leases.delete(existing.session_id);
    }
    const created = store.create(kind, workspace);
    this.#leases.set(created.session_id, taskId);
    return {
      session_id: created.session_id,
      kind: created.kind,
      workspace,
      thread_id: null,
      mode: "start",
      generation: created.generation,
    };
  }

  #planForKind(kind: ServiceSessionKind, workspaceInput: string, taskId: string): ServiceSessionPlan {
    const workspace = normalizeWorkspace(workspaceInput);
    const store = this.#requireStore();
    const existing = store.find(kind, workspace);
    if (
      existing &&
      existing.thread_id &&
      existing.turn_count < this.maxTurns &&
      !this.#leases.has(existing.session_id)
    ) {
      this.#leases.set(existing.session_id, taskId);
      return {
        session_id: existing.session_id,
        kind: existing.kind,
        workspace,
        thread_id: existing.thread_id,
        mode: "resume",
        generation: existing.generation,
      };
    }
    if (existing && existing.status === "active" && existing.turn_count >= this.maxTurns) {
      store.retire(existing.session_id, "turn-limit");
      this.#leases.delete(existing.session_id);
    }
    const created = store.create(kind, workspace);
    this.#leases.set(created.session_id, taskId);
    return {
      session_id: created.session_id,
      kind: created.kind,
      workspace,
      thread_id: created.thread_id,
      mode: "start",
      generation: created.generation,
    };
  }

  planFresh(workspaceInput: string, taskId: string, reason: string): ServiceSessionPlan {
    return this.rotate("service", workspaceInput, taskId, reason);
  }

  claimExistingThread(threadId: string, taskId: string): ServiceSessionRecord | null {
    const store = this.#requireStore();
    const session = store.byThread(threadId);
    if (!session || session.status !== "active") return null;
    const lease = this.#leases.get(session.session_id);
    if (lease && lease !== taskId) return null;
    this.#leases.set(session.session_id, taskId);
    return session;
  }

  bindThread(plan: ServiceSessionPlan, threadId: string, taskId: string): ServiceSessionRecord {
    const store = this.#requireStore();
    return store.bindThread(plan.session_id, threadId, taskId);
  }

  markTurnAccepted(sessionId: string, taskId: string): ServiceSessionRecord {
    return this.#requireStore().markTurnAccepted(sessionId, taskId);
  }

  complete(taskId: string, success: boolean): void {
    const entries = [...this.#leases.entries()].filter(([, owner]) => owner === taskId);
    for (const [sessionId] of entries) {
      this.#leases.delete(sessionId);
      if (success) {
        const session = this.#requireStore().byId(sessionId);
        if (session) this.#requireStore().markTurnCompleted(session.session_id, taskId);
      }
    }
  }

  status(): Record<string, unknown> {
    const sessions = this.store?.list() ?? [];
    const active = sessions.filter((session) => session.status === "active");
    return {
      name: "Bridge Agent",
      technical_name: "Service Codex",
      owner: "bridge-agent",
      owner_process_id: this.ownerProcessId,
      status: "ready",
      max_thread_turns: this.maxTurns,
      active_sessions: active.length,
      leased_sessions: this.#leases.size,
      sessions: sessions.map((session) => ({
        ...session,
        lease: this.#leases.get(session.session_id)
          ? { state: "leased", task_id: this.#leases.get(session.session_id) }
          : { state: "idle", task_id: null },
      })),
      durable_metadata_only: true,
      transcript_store: "native-codex-only",
      updated_at: this.#clock().toISOString(),
    };
  }

  #requireStore(): ServiceSessionStore {
    if (!this.store) throw new Error("service session persistence is not configured");
    return this.store;
  }
}

export function resolveServiceSessionFile(
  environment: NodeJS.ProcessEnv = process.env,
  currentDirectory = process.cwd(),
): string {
  const configured = environment[SERVICE_SESSION_FILE_ENV]?.trim();
  if (configured) {
    if (!isAbsolute(configured) || /\0|\r|\n/.test(configured)) {
      throw new Error(`${SERVICE_SESSION_FILE_ENV} must be an absolute path without control characters`);
    }
    return resolve(configured);
  }
  const localAppData = environment.LOCALAPPDATA?.trim();
  if (localAppData && isAbsolute(localAppData)) {
    return join(localAppData, "LocalCodexBridge", "service_sessions.json");
  }
  return join(currentDirectory, "service_sessions.json");
}

export function normalizeServiceWorkspace(value: string): string {
  return normalizeWorkspace(value);
}
