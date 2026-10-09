import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TaskManager } from "../src/task-manager.js";

test("durable task store persists ownership, retry, claim, and result fields", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-durable-"));
  const filePath = join(directory, "tasks.json");
  try {
    const manager = new TaskManager(filePath);
    const task = manager.create({
      name: "durable",
      fingerprint: "stable-durable-key",
      status: "RUNNING",
      worker_id: "luna-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      cwd: "C:\\Bridge",
      write_claims: ["c:\\bridge"],
      started_at: "2026-08-21T01:00:00.000Z",
      retry_count: 2,
      last_error: "server overloaded",
      active: true,
    });
    manager.update(task.id, {
      status: "COMPLETED",
      completed_at: "2026-08-21T01:01:00.000Z",
      result_summary: "完成",
      output_files: ["C:\\Bridge\\result.txt"],
      output_directories: ["C:\\Bridge\\out"],
      worker_id: null,
    });
    const reloaded = new TaskManager(filePath);
    const persisted = reloaded.get(task.id);
    assert.equal(reloaded.snapshot().schema_version, 7);
    assert.equal(persisted.fingerprint, "stable-durable-key");
    assert.equal(persisted.worker_id, null);
    assert.equal(persisted.thread_id, "thread-1");
    assert.equal(persisted.turn_id, "turn-1");
    assert.deepEqual(persisted.write_claims, ["c:\\bridge"]);
    assert.equal(persisted.retry_count, 2);
    assert.equal(persisted.result_summary, "完成");
    assert.deepEqual(persisted.output_files, ["C:\\Bridge\\result.txt"]);
    assert.deepEqual(persisted.output_directories, ["C:\\Bridge\\out"]);
    assert.equal(reloaded.findByFingerprint("stable-durable-key")?.id, task.id);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v5 records gain bounded output directory handoff fields", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-v5-migrate-"));
  const filePath = join(directory, "tasks.json");
  try {
    writeFileSync(filePath, JSON.stringify({
      schema_version: 5,
      active_task_id: "task-v5",
      tasks: [{
        id: "task-v5",
        fingerprint: "legacy-v5",
        name: "old v5",
        type: "Codex 原生任务",
        account: "",
        skill: "",
        status: "COMPLETED",
        progress: 100,
        stage: "完成",
        current_action: "完成",
        next_action: "无",
        completed_items: [],
        output_files: [],
        result_summary: "完成",
        worker_id: null,
        thread_id: "thread-v5",
        turn_id: "turn-v5",
        cwd: "C:\\Bridge",
        write_claims: [],
        started_at: null,
        completed_at: "2026-08-21T01:00:00.000Z",
        retry_count: 0,
        last_error: null,
        created_at: "2026-08-21T01:00:00.000Z",
        updated_at: "2026-08-21T01:00:00.000Z",
      }],
      events: [],
      updated_at: "2026-08-21T01:00:00.000Z",
    }), "utf8");
    const manager = new TaskManager(filePath);
    assert.equal(manager.snapshot().schema_version, 7);
    assert.deepEqual(manager.get("task-v5").output_directories, []);
    assert.ok(readFileSync(filePath + ".schema5.bak", "utf8").includes('"schema_version":5'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v4 unfinished records migrate to v7 without losing mapping", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-v4-migrate-"));
  const filePath = join(directory, "tasks.json");
  try {
    writeFileSync(filePath, JSON.stringify({
      schema_version: 4,
      active_task_id: "task-v4",
      tasks: [{
        id: "task-v4",
        name: "old",
        type: "Codex 原生任务",
        account: "",
        skill: "",
        status: "RUNNING",
        progress: 20,
        stage: "执行",
        current_action: "运行",
        next_action: "等待",
        completed_items: [],
        output_files: [],
        result_summary: "",
        created_at: "2026-08-21T01:00:00.000Z",
        updated_at: "2026-08-21T01:00:00.000Z",
      }],
      events: [],
      updated_at: "2026-08-21T01:00:00.000Z",
    }), "utf8");
    const manager = new TaskManager(filePath);
    assert.equal(manager.snapshot().schema_version, 7);
    assert.equal(manager.get("task-v4").status, "RUNNING");
    assert.ok(readFileSync(filePath + ".schema4.bak", "utf8").includes('"schema_version":4'));
    assert.equal(manager.get("task-v4").fingerprint.startsWith("legacy-v4:"), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v6 completed task without manifest migrates to legacy handoff safely", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-v6-migrate-"));
  const filePath = join(directory, "tasks.json");
  try {
    writeFileSync(filePath, JSON.stringify({
      schema_version: 6,
      active_task_id: "task-v6",
      tasks: [{
        id: "task-v6",
        fingerprint: "legacy-v6",
        name: "旧 V4.1 完成任务",
        type: "Codex 原生任务",
        account: "",
        skill: "",
        status: "COMPLETED",
        progress: 100,
        stage: "完成",
        current_action: "完成",
        next_action: "无",
        completed_items: [],
        output_files: [],
        output_directories: [],
        result_summary: "旧结果",
        worker_id: null,
        thread_id: "thread-v6",
        turn_id: "turn-v6",
        cwd: "C:\\Bridge",
        write_claims: [],
        started_at: null,
        completed_at: "2026-08-21T01:00:00.000Z",
        retry_count: 0,
        last_error: null,
        created_at: "2026-08-21T01:00:00.000Z",
        updated_at: "2026-08-21T01:00:00.000Z",
      }],
      events: [],
      updated_at: "2026-08-21T01:00:00.000Z",
    }), "utf8");
    const manager = new TaskManager(filePath);
    const migrated = manager.get("task-v6");
    assert.equal(manager.snapshot().schema_version, 7);
    assert.equal(migrated.result_manifest.review_status, "LEGACY");
    assert.equal(migrated.result_manifest.execution_status, "COMPLETED");
    assert.ok(readFileSync(filePath + ".schema6.bak", "utf8").includes('"schema_version":6'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
