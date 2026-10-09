import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const NATIVE_HISTORY_PAGE_SIZE = 20;

const MAX_ITEM_JSON_BYTES = 64 * 1024;
const MAX_ITEM_TEXT_CHARS = 12_000;

export interface NativeThreadHistoryOptions {
  limit?: number;
  beforeOrdinal?: number | null;
  databasePath?: string;
}

export interface NativeThreadHistoryItem {
  item_id: string;
  turn_id: string;
  ordinal: number;
  created_at: string | null;
  item_type: string;
  role: string | null;
  text: string | null;
  truncated: boolean;
}

export interface NativeThreadHistoryPage {
  source: "codex-thread-history-sqlite";
  database_path: string;
  thread_id: string;
  available: boolean;
  items: NativeThreadHistoryItem[];
  next_cursor: string | null;
  has_more: boolean;
  error: string | null;
}

export type NativeThreadHistoryReader = (
  threadId: string,
  options: NativeThreadHistoryOptions,
) => NativeThreadHistoryPage;

export function nativeHistoryDatabasePath(): string {
  return join(homedir(), ".codex", "thread_history_1.sqlite");
}

function boundedString(value: unknown, maxLength = MAX_ITEM_TEXT_CHARS): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "…";
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

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textFromValue(value: unknown, depth = 0): string | null {
  if (depth > 5 || value === null || value === undefined) return null;
  const direct = boundedString(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    const parts = value
      .slice(0, 20)
      .map((item) => textFromValue(item, depth + 1))
      .filter((item): item is string => item !== null);
    return parts.length > 0 ? boundedString(parts.join("\n")) : null;
  }
  const record = object(value);
  if (!record) return null;
  for (const field of [
    "text",
    "summary",
    "content",
    "message",
    "output",
    "final_answer",
    "finalAnswer",
    "query",
    "command",
    "aggregatedOutput",
    "stdout",
    "stderr",
    "description",
    "reason",
    "name",
  ]) {
    const text = textFromValue(record[field], depth + 1);
    if (text) return text;
  }
  return null;
}

function itemRole(itemType: string): string | null {
  if (itemType === "userMessage") return "user";
  if (itemType === "agentMessage") return "assistant";
  return null;
}

function itemText(
  itemType: string,
  boundedJson: unknown,
  jsonBytes: number,
): { text: string | null; truncated: boolean } {
  if (itemType === "imageGeneration") {
    return {
      text: "图片生成内容（大型媒体数据已省略）",
      truncated: jsonBytes > MAX_ITEM_JSON_BYTES,
    };
  }
  if (boundedJson === null) {
    return {
      text: "该历史项内容较大，已仅加载元数据。",
      truncated: true,
    };
  }
  const text = textFromValue(boundedJson);
  return {
    text: text ?? `历史项：${itemType}`,
    truncated: jsonBytes > MAX_ITEM_JSON_BYTES,
  };
}

function unavailable(
  databasePath: string,
  threadId: string,
  error: unknown,
): NativeThreadHistoryPage {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim().slice(0, 500)
    : "native thread history is unavailable";
  return {
    source: "codex-thread-history-sqlite",
    database_path: databasePath,
    thread_id: threadId,
    available: false,
    items: [],
    next_cursor: null,
    has_more: false,
    error: message,
  };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return NATIVE_HISTORY_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > NATIVE_HISTORY_PAGE_SIZE) {
    throw new Error(`history limit must be an integer from 1 to ${NATIVE_HISTORY_PAGE_SIZE}`);
  }
  return value;
}

function normalizeCursor(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("history cursor must be a non-negative integer");
  }
  return value;
}

/** Read bounded native history pages from Codex's own read-only projection. */
export function readNativeThreadHistory(
  threadId: string,
  options: NativeThreadHistoryOptions = {},
): NativeThreadHistoryPage {
  const databasePath = options.databasePath ?? nativeHistoryDatabasePath();
  const limit = normalizeLimit(options.limit);
  const beforeOrdinal = normalizeCursor(options.beforeOrdinal);
  if (!threadId.trim()) return unavailable(databasePath, threadId, new Error("thread id is required"));
  if (!existsSync(databasePath)) return unavailable(databasePath, threadId, new Error("native thread history database was not found"));

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const where = beforeOrdinal === null
      ? "thread_id = ?"
      : "thread_id = ? AND rollout_ordinal < ?";
    const sql = `
      SELECT
        item_id,
        turn_id,
        rollout_ordinal,
        created_at_ms,
        item_type,
        length(item_json) AS item_json_bytes,
        CASE WHEN length(item_json) <= ? THEN item_json ELSE NULL END AS bounded_item_json
      FROM thread_items
      WHERE ${where}
      ORDER BY rollout_ordinal DESC
      LIMIT ?
    `;
    const parameters: Array<string | number> = [
      MAX_ITEM_JSON_BYTES,
      threadId,
      ...(beforeOrdinal === null ? [] : [beforeOrdinal]),
      limit + 1,
    ];
    const rows = database.prepare(sql).all(...parameters) as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit).reverse();
    const items = selected.map((row) => {
      const itemType = boundedString(row.item_type, 120) ?? "unknown";
      const jsonBytes = typeof row.item_json_bytes === "number" ? row.item_json_bytes : 0;
      let parsed: unknown = null;
      if (typeof row.bounded_item_json === "string") {
        try {
          parsed = JSON.parse(row.bounded_item_json) as unknown;
        } catch {
          parsed = null;
        }
      }
      const display = itemText(itemType, parsed, jsonBytes);
      return {
        item_id: boundedString(row.item_id, 200) ?? "unknown-item",
        turn_id: boundedString(row.turn_id, 200) ?? "unknown-turn",
        ordinal: typeof row.rollout_ordinal === "number" ? row.rollout_ordinal : 0,
        created_at: isoTimestamp(row.created_at_ms),
        item_type: itemType,
        role: itemRole(itemType),
        text: display.text,
        truncated: display.truncated,
      } satisfies NativeThreadHistoryItem;
    });
    return {
      source: "codex-thread-history-sqlite",
      database_path: databasePath,
      thread_id: threadId,
      available: true,
      items,
      next_cursor: hasMore && items[0] ? String(items[0].ordinal) : null,
      has_more: hasMore,
      error: null,
    };
  } catch (error) {
    return unavailable(databasePath, threadId, error);
  } finally {
    database?.close();
  }
}
