import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { TaskManager, readTaskManagerSnapshot } from "../src/task-manager.js";
import { ResultService } from "../src/result-service.js";
import { buildExecutionResult } from "../src/execution-result.js";
import { TaskRuntime } from "../src/task-runtime.js";
import { TaskStatusStore } from "../src/task-status.js";
import { TaskStatusServer } from "./browser-safe-status-server.js";

function temporaryStore(): { root: string; manager: TaskManager } {
  const root = mkdtempSync(join(process.cwd(), ".staging", "execution-result-中文 空格-"));
  return { root, manager: new TaskManager(join(root, "tasks.json")) };
}

function task(manager: TaskManager, root: string, required: string[], status: "COMPLETED" | "FAILED" = "COMPLETED") {
  return manager.create({
    name: "result contract test",
    type: "test",
    execution_source: "bridge",
    status,
    progress: status === "COMPLETED" ? 100 : 20,
    cwd: root,
    started_at: new Date().toISOString(),
    result_manifest: { required_outputs: required },
  });
}

test("successful command plus verified required output is completed", () => {
  const temporary = temporaryStore();
  try {
    const output = join(temporary.root, "result.txt");
    writeFileSync(output, "ok", "utf8");
    const created = task(temporary.manager, temporary.root, [output]);
    const manifest = new ResultService(temporary.manager).finalize(created.id);
    const updated = temporary.manager.get(created.id);
    assert.equal(updated.status, "COMPLETED");
    assert.deepEqual(manifest.execution_result?.verified_outputs, [output]);
    assert.deepEqual(manifest.execution_result?.missing_outputs, []);
    assert.equal(manifest.execution_result?.command_success, true);
  } finally {
    rmSync(temporary.root, { recursive: true, force: true });
  }
});

test("DONE text with a missing required output is failed, not completed", () => {
  const temporary = temporaryStore();
  try {
    const output = join(temporary.root, "missing.jpg");
    const created = task(temporary.manager, temporary.root, [output]);
    temporary.manager.update(created.id, { final_answer: "DONE" });
    new ResultService(temporary.manager).finalize(created.id);
    const updated = temporary.manager.get(created.id);
    assert.equal(updated.status, "FAILED");
    assert.equal(updated.last_error, "任务要求的输出文件未生成，未完成。");
    assert.deepEqual(updated.result_manifest.execution_result?.missing_outputs, [output]);
  } finally {
    rmSync(temporary.root, { recursive: true, force: true });
  }
});

test("zero output files with required outputs cannot complete", () => {
  const temporary = temporaryStore();
  try {
    const output = join(temporary.root, "required.bin");
    const created = task(temporary.manager, temporary.root, [output]);
    const execution = buildExecutionResult(temporary.manager.get(created.id));
    assert.equal(execution.required_outputs.length, 1);
    assert.equal(execution.missing_outputs.length, 1);
    new ResultService(temporary.manager).finalize(created.id);
    assert.equal(temporary.manager.get(created.id).status, "FAILED");
  } finally {
    rmSync(temporary.root, { recursive: true, force: true });
  }
});

test("process creation 267 stays failed and exposes a structured error code", () => {
  const temporary = temporaryStore();
  try {
    const output = join(temporary.root, "required.jpg");
    const created = task(temporary.manager, temporary.root, [output], "FAILED");
    temporary.manager.update(created.id, { last_error: "CreateProcessAsUserW failed: 267" });
    const execution = buildExecutionResult(temporary.manager.get(created.id));
    assert.equal(execution.command_success, false);
    assert.equal(execution.error_code, "win32_create_process_invalid_directory_267");
    new ResultService(temporary.manager).finalize(created.id);
    assert.equal(temporary.manager.get(created.id).status, "FAILED");
  } finally {
    rmSync(temporary.root, { recursive: true, force: true });
  }
});

test("TaskRuntime completion event is converted to failure when required output is missing", () => {
  const temporary = temporaryStore();
  try {
    const output = join(temporary.root, "missing-output.txt");
    const created = task(temporary.manager, temporary.root, [output], "FAILED");
    temporary.manager.update(created.id, { status: "RUNNING", progress: 20, last_error: null });
    const event = new TaskRuntime(temporary.manager).complete(created.id, {
      result_summary: "DONE",
    });
    assert.equal(event.type, "ERROR");
    assert.equal(temporary.manager.get(created.id).status, "FAILED");
    assert.equal(temporary.manager.get(created.id).result_manifest.execution_result?.error_code, "required_output_missing");
  } finally {
    rmSync(temporary.root, { recursive: true, force: true });
  }
});

test("restart loads persisted required-output contracts without rewriting history", () => {
  const temporary = temporaryStore();
  try {
    const output = join(temporary.root, "persisted-result.txt");
    writeFileSync(output, "verified", "utf8");
    const created = task(temporary.manager, temporary.root, [output]);
    new ResultService(temporary.manager).finalize(created.id);
    const before = readFileSync(temporary.manager.filePath);
    const reopened = new TaskManager(temporary.manager.filePath);
    assert.equal(reopened.get(created.id).status, "COMPLETED");
    assert.deepEqual(reopened.get(created.id).result_manifest.required_outputs, [output]);
    assert.deepEqual(reopened.get(created.id).result_manifest.execution_result?.verified_outputs, [output]);
    assert.equal(readTaskManagerSnapshot(temporary.manager.filePath)?.tasks.length, 1);
    assert.deepEqual(readFileSync(temporary.manager.filePath), before);
  } finally {
    rmSync(temporary.root, { recursive: true, force: true });
  }
});

test("Control Center starts after reloading a store with persisted output contracts", async () => {
  const temporary = temporaryStore();
  let server: TaskStatusServer | undefined;
  try {
    const output = join(temporary.root, "required-output.txt");
    const created = task(temporary.manager, temporary.root, [output], "FAILED");
    temporary.manager.update(created.id, { last_error: "output missing" });
    new ResultService(temporary.manager).finalize(created.id);
    const before = readFileSync(temporary.manager.filePath);
    const reopened = new TaskManager(temporary.manager.filePath);
    const status = new TaskStatusStore(join(temporary.root, "status.json"));
    server = new TaskStatusServer(status, reopened, new TaskRuntime(reopened), { port: 0 });
    const address = await server.start();
    const app = await fetch(`http://127.0.0.1:${address.port}/app`);
    assert.equal(app.status, 200);
    assert.match(await app.text(), /Control Center/);
    const api = await fetch(`http://127.0.0.1:${address.port}/api/status`);
    assert.equal(api.status, 200);
    assert.equal(reopened.get(created.id).status, "FAILED");
    assert.deepEqual(readFileSync(temporary.manager.filePath), before);
  } finally {
    await server?.close();
    rmSync(temporary.root, { recursive: true, force: true });
  }
});
