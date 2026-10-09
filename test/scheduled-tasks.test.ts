import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { McpHealthState } from "../src/mcp-health.js";
import { ModelGuard } from "../src/model-guard.js";
import { readScheduledTasks } from "../src/scheduled-tasks.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskRuntime } from "../src/task-runtime.js";
import { TaskStatusServer } from "./browser-safe-status-server.js";
import { TaskStatusStore } from "../src/task-status.js";

function createFixtureDatabase(directory: string): string {
  const databasePath = join(directory, "codex-dev.db");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        name TEXT,
        status TEXT,
        next_run_at INTEGER,
        last_run_at INTEGER,
        rrule TEXT,
        kind TEXT,
        target_thread_id TEXT
      );
      CREATE TABLE automation_runs (
        thread_id TEXT,
        automation_id TEXT,
        status TEXT,
        read_at INTEGER,
        thread_title TEXT,
        source_cwd TEXT,
        inbox_title TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        archived_user_message TEXT,
        archived_assistant_message TEXT,
        archived_reason TEXT
      );
    `);
    const automation = database.prepare(`
      INSERT INTO automations (id, name, status, next_run_at, last_run_at, rrule, kind, target_thread_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    automation.run(
      "weekday-kos",
      "工作日 KOS 内容生产",
      "ACTIVE",
      1_800_000_000_000,
      1_799_000_000_000,
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=0",
      "heartbeat",
      "thread-kos",
    );
    automation.run(
      "travel-topics",
      "旅行选题库更新",
      "PAUSED",
      null,
      1_798_000_000_000,
      "RRULE:FREQ=WEEKLY;BYHOUR=8;BYMINUTE=30",
      "cron",
      null,
    );
    const run = database.prepare(`
      INSERT INTO automation_runs (
        thread_id, automation_id, status, read_at, thread_title, source_cwd,
        inbox_title, created_at, updated_at, archived_user_message,
        archived_assistant_message, archived_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    run.run(
      "thread-old",
      "weekday-kos",
      "ARCHIVED",
      1_799_100_000_000,
      "旧运行",
      "C:\\Projects\\xai",
      "旧收件箱",
      1_799_000_000_000,
      1_799_100_000_000,
      "secret user prompt",
      "secret assistant transcript",
      "old",
    );
    run.run(
      "thread-kos",
      "weekday-kos",
      "PENDING_REVIEW",
      null,
      "最近运行",
      "C:\\Projects\\xai",
      "最近收件箱",
      1_799_200_000_000,
      1_799_300_000_000,
      "secret newer prompt",
      "secret newer transcript",
      null,
    );
  } finally {
    database.close();
  }
  return databasePath;
}

test("Scheduled Tasks read model reads automation definitions and latest run only", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-scheduled-tasks-"));
  try {
    const databasePath = createFixtureDatabase(directory);
    const snapshot = readScheduledTasks(databasePath);
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.source, "codex-dev.db");
    assert.equal(snapshot.items.length, 2);
    assert.deepEqual(snapshot.items.map((item) => item.id), ["weekday-kos", "travel-topics"]);
    assert.equal(snapshot.items[0]?.status, "ACTIVE");
    assert.equal(snapshot.items[0]?.target_thread_id, "thread-kos");
    assert.equal(snapshot.items[0]?.next_run_at_ms, 1_800_000_000_000);
    assert.equal(snapshot.items[0]?.latest_run?.status, "PENDING_REVIEW");
    assert.equal(snapshot.items[0]?.latest_run?.thread_id, "thread-kos");
    assert.equal(snapshot.items[0]?.latest_run?.updated_at, "2027-01-07T05:33:20.000Z");
    assert.equal(snapshot.items[1]?.status, "PAUSED");
    assert.equal(snapshot.items[1]?.next_run_at, null);
    assert.equal(snapshot.items[1]?.latest_run, null);
    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes("secret user prompt"), false);
    assert.equal(serialized.includes("secret assistant transcript"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Scheduled Tasks missing database fails closed without creating it", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-scheduled-missing-"));
  try {
    const databasePath = join(directory, "missing", "codex-dev.db");
    const snapshot = readScheduledTasks(databasePath);
    assert.equal(snapshot.available, false);
    assert.deepEqual(snapshot.items, []);
    assert.equal(existsSync(databasePath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Scheduled Tasks endpoint stays separate from Native Threads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-scheduled-api-"));
  const statusStore = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), statusStore);
  const runtime = new TaskRuntime(manager);
  const scheduled = {
    source: "codex-dev.db" as const,
    database_path: "C:\\Users\\test\\.codex\\sqlite\\codex-dev.db",
    available: true,
    read_at: "2026-09-01T00:00:00.000Z",
    error: null,
    items: [{
      id: "scheduled-1",
      name: "只读自动化",
      status: "ACTIVE",
      rrule: "RRULE:FREQ=DAILY",
      kind: "heartbeat",
      next_run_at: "2026-09-01T08:00:00.000Z",
      last_run_at: null,
      next_run_at_ms: 1_000,
      last_run_at_ms: null,
      target_thread_id: null,
      latest_run: null,
    }],
  };
  const server = new TaskStatusServer(statusStore, manager, runtime, {
    port: 0,
    modelGuard: new ModelGuard(),
    mcpHealth: new McpHealthState(),
    scheduledTasks: () => scheduled,
  });
  try {
    const address = await server.start();
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + "/api/scheduled-tasks");
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.items[0].id, "scheduled-1");
    assert.equal(body.native_threads, undefined);

    const diagnostics = await (await fetch(base + "/api/diagnostics")).json() as Record<string, any>;
    assert.equal(diagnostics.endpoints.scheduled_tasks, "/api/scheduled-tasks");
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
