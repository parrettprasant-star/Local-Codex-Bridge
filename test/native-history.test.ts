import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { McpHealthState } from "../src/mcp-health.js";
import { ModelGuard } from "../src/model-guard.js";
import { readNativeThreadHistory } from "../src/native-history.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskRuntime } from "../src/task-runtime.js";
import { TaskStatusServer } from "./browser-safe-status-server.js";
import { TaskStatusStore } from "../src/task-status.js";

const THREAD_ID = "thread-history-fixture";

function createHistoryDatabase(directory: string): string {
  const path = join(directory, "thread_history_1.sqlite");
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE thread_items (
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        rollout_ordinal INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        item_json TEXT NOT NULL,
        item_type TEXT NOT NULL DEFAULT '',
        updated_at_ordinal INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (thread_id, turn_id, item_id)
      );
    `);
    const insert = database.prepare(`
      INSERT INTO thread_items (
        thread_id, turn_id, item_id, rollout_ordinal, created_at_ms,
        item_json, item_type, updated_at_ordinal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let ordinal = 1; ordinal <= 25; ordinal += 1) {
      const itemType = ordinal === 25
        ? "imageGeneration"
        : ordinal % 2 === 0
          ? "agentMessage"
          : "userMessage";
      const item = itemType === "imageGeneration"
        ? { type: itemType, id: `item-${ordinal}`, data: "x".repeat(70_000) }
        : itemType === "agentMessage"
          ? { type: itemType, id: `item-${ordinal}`, text: `Codex 内容 ${ordinal}` }
          : { type: itemType, id: `item-${ordinal}`, content: [{ type: "text", text: `用户内容 ${ordinal}` }] };
      insert.run(
        THREAD_ID,
        `turn-${Math.ceil(ordinal / 2)}`,
        `item-${ordinal}`,
        ordinal,
        1_700_000_000_000 + ordinal * 1_000,
        JSON.stringify(item),
        itemType,
        ordinal,
      );
    }
  } finally {
    database.close();
  }
  return path;
}

test("native history reads bounded pages and omits oversized item payloads", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-native-history-"));
  try {
    const databasePath = createHistoryDatabase(directory);
    const first = readNativeThreadHistory(THREAD_ID, { databasePath });
    assert.equal(first.available, true);
    assert.equal(first.items.length, 20);
    assert.equal(first.items[0]?.ordinal, 6);
    assert.equal(first.items.at(-1)?.ordinal, 25);
    assert.equal(first.has_more, true);
    assert.equal(first.next_cursor, "6");
    assert.equal(first.items.at(-1)?.item_type, "imageGeneration");
    assert.equal(first.items.at(-1)?.truncated, true);
    assert.equal(first.items.at(-1)?.text, "图片生成内容（大型媒体数据已省略）");
    assert.ok(JSON.stringify(first).length < 100_000);

    const second = readNativeThreadHistory(THREAD_ID, {
      databasePath,
      beforeOrdinal: Number(first.next_cursor),
    });
    assert.equal(second.available, true);
    assert.equal(second.items.length, 5);
    assert.equal(second.items[0]?.ordinal, 1);
    assert.equal(second.items.at(-1)?.ordinal, 5);
    assert.equal(second.has_more, false);
    assert.equal(second.next_cursor, null);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.item_id)).size, 25);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native history endpoint supports cursor pagination without changing Native Threads API", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-native-history-api-"));
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const runtime = new TaskRuntime(manager);
  const databasePath = createHistoryDatabase(directory);
  const calls: Array<{ threadId: string; options: Record<string, unknown> }> = [];
  const server = new TaskStatusServer(statusStore, manager, runtime, {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    nativeHistory: (threadId, options) => {
      calls.push({ threadId, options: { ...options } });
      return readNativeThreadHistory(threadId, { ...options, databasePath });
    },
  });
  try {
    const address = await server.start();
    const base = `http://127.0.0.1:${address.port}`;
    const firstResponse = await fetch(base + `/api/native-threads/${THREAD_ID}/history?limit=20`);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as Record<string, any>;
    assert.equal(first.items.length, 20);
    assert.equal(first.next_cursor, "6");
    const secondResponse = await fetch(base + `/api/native-threads/${THREAD_ID}/history?limit=20&cursor=6`);
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json() as Record<string, any>;
    assert.equal(second.items.length, 5);
    assert.equal(calls[0]?.threadId, THREAD_ID);
    assert.equal(calls[0]?.options.limit, 20);
    assert.equal(calls[1]?.options.beforeOrdinal, 6);

    const invalid = await fetch(base + `/api/native-threads/${THREAD_ID}/history?cursor=not-a-number`);
    assert.equal(invalid.status, 400);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native history missing database fails closed without creating it", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-native-history-missing-"));
  try {
    const databasePath = join(directory, "missing", "thread_history_1.sqlite");
    const result = readNativeThreadHistory(THREAD_ID, { databasePath });
    assert.equal(result.available, false);
    assert.deepEqual(result.items, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
