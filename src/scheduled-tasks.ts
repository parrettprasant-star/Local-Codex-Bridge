import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MAX_AUTOMATIONS = 100;
const MAX_STRING_LENGTH = 800;

export interface ScheduledTaskRunView {
  thread_id: string | null;
  automation_id: string;
  status: string | null;
  read_at: string | null;
  thread_title: string | null;
  source_cwd: string | null;
  inbox_title: string | null;
  created_at: string | null;
  updated_at: string | null;
  archived_reason: string | null;
}

export interface ScheduledTaskView {
  id: string;
  name: string;
  status: string;
  rrule: string | null;
  kind: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  next_run_at_ms: number | null;
  last_run_at_ms: number | null;
  target_thread_id: string | null;
  latest_run: ScheduledTaskRunView | null;
}

export interface ScheduledTasksSnapshot {
  source: "codex-dev.db";
  database_path: string;
  available: boolean;
  read_at: string;
  error: string | null;
  items: ScheduledTaskView[];
}

export function scheduledTasksDatabasePath(): string {
  return join(homedir(), ".codex", "sqlite", "codex-dev.db");
}

function boundedString(value: unknown, maxLength = MAX_STRING_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "…";
}

function requiredString(value: unknown, fallback: string): string {
  return boundedString(value) ?? fallback;
}

function epochMilliseconds(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "bigint"
      ? Number(value)
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numeric)) return null;
  const milliseconds = Math.abs(numeric) < 100_000_000_000 ? numeric * 1_000 : numeric;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function isoTimestamp(value: unknown): string | null {
  const milliseconds = epochMilliseconds(value);
  if (milliseconds === null) return null;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeStatus(value: unknown): string {
  return requiredString(value, "UNKNOWN").toUpperCase();
}

function readLatestRun(
  database: DatabaseSync,
  automationId: string,
): ScheduledTaskRunView | null {
  const row = database.prepare(`
    SELECT
      thread_id,
      automation_id,
      status,
      read_at,
      thread_title,
      source_cwd,
      inbox_title,
      created_at,
      updated_at,
      archived_reason
    FROM automation_runs
    WHERE automation_id = ?
    ORDER BY COALESCE(updated_at, created_at, 0) DESC
    LIMIT 1
  `).get(automationId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    thread_id: boundedString(row.thread_id),
    automation_id: requiredString(row.automation_id, automationId),
    status: boundedString(row.status)?.toUpperCase() ?? null,
    read_at: isoTimestamp(row.read_at),
    thread_title: boundedString(row.thread_title),
    source_cwd: boundedString(row.source_cwd),
    inbox_title: boundedString(row.inbox_title),
    created_at: isoTimestamp(row.created_at),
    updated_at: isoTimestamp(row.updated_at),
    archived_reason: boundedString(row.archived_reason),
  };
}

function unavailable(databasePath: string, error: unknown): ScheduledTasksSnapshot {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim().slice(0, MAX_STRING_LENGTH)
    : "scheduled task database is unavailable";
  return {
    source: "codex-dev.db",
    database_path: databasePath,
    available: false,
    read_at: new Date().toISOString(),
    error: message,
    items: [],
  };
}

/**
 * Read the Codex Desktop automation catalog without mutating the database.
 * Scheduled tasks intentionally remain separate from the native thread API.
 */
export function readScheduledTasks(databasePath = scheduledTasksDatabasePath()): ScheduledTasksSnapshot {
  if (!existsSync(databasePath)) return unavailable(databasePath, new Error("scheduled task database was not found"));

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(`
      SELECT
        id,
        name,
        status,
        next_run_at,
        last_run_at,
        rrule,
        kind,
        target_thread_id
      FROM automations
      ORDER BY COALESCE(next_run_at, last_run_at, 0) DESC, id ASC
      LIMIT ?
    `).all(MAX_AUTOMATIONS) as Array<Record<string, unknown>>;

    const items = rows.map((row) => {
      const id = requiredString(row.id, "unknown-automation");
      const nextRunMs = epochMilliseconds(row.next_run_at);
      const lastRunMs = epochMilliseconds(row.last_run_at);
      return {
        id,
        name: requiredString(row.name, "未命名自动化"),
        status: normalizeStatus(row.status),
        rrule: boundedString(row.rrule),
        kind: boundedString(row.kind),
        next_run_at: isoTimestamp(row.next_run_at),
        last_run_at: isoTimestamp(row.last_run_at),
        next_run_at_ms: nextRunMs,
        last_run_at_ms: lastRunMs,
        target_thread_id: boundedString(row.target_thread_id),
        latest_run: readLatestRun(database!, id),
      } satisfies ScheduledTaskView;
    });

    return {
      source: "codex-dev.db",
      database_path: databasePath,
      available: true,
      read_at: new Date().toISOString(),
      error: null,
      items,
    };
  } catch (error) {
    return unavailable(databasePath, error);
  } finally {
    database?.close();
  }
}
