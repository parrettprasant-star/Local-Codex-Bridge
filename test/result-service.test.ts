import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ResultService } from "../src/result-service.js";
import { TaskManager } from "../src/task-manager.js";

test("result manifest persists completion, integrity, and review lifecycle across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-result-service-"));
  const filePath = join(directory, "tasks.json");
  try {
    const manager = new TaskManager(filePath);
    const task = manager.create({
      name: "交付结果",
      fingerprint: "result-manifest-key",
      status: "COMPLETED",
      thread_id: "thread-result",
      turn_id: "turn-result",
      cwd: "C:\\Bridge",
      result_summary: "已完成结果整理",
      output_files: ["C:\\Bridge\\missing.txt"],
      output_directories: ["C:\\Bridge\\out"],
    });
    const service = new ResultService(manager);
    const finalized = service.finalize(task.id);
    assert.equal(finalized.execution_status, "COMPLETED");
    assert.equal(finalized.review_status, "READY");
    assert.equal(finalized.task_title, "交付结果");
    assert.equal(finalized.thread_id, "thread-result");
    assert.equal(finalized.resume_command, "codex resume thread-result");
    assert.equal(finalized.result_summary, "已完成结果整理");
    assert.deepEqual(finalized.output_files, ["C:\\Bridge\\missing.txt"]);
    assert.deepEqual(finalized.output_directories, ["C:\\Bridge\\out"]);
    assert.equal(finalized.integrity.status, "WARN");

    const reloaded = new TaskManager(filePath);
    const reloadedService = new ResultService(reloaded);
    assert.equal(reloadedService.get(task.id).review_status, "READY");
    assert.equal(reloadedService.get(task.id).integrity.status, "WARN");
    assert.equal(reloadedService.markReviewed(task.id).review_status, "REVIEWED");
    assert.equal(new ResultService(new TaskManager(filePath)).get(task.id).review_status, "REVIEWED");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed execution keeps FAILED status and is never marked completed", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-result-failed-"));
  try {
    const manager = new TaskManager(join(directory, "tasks.json"));
    const task = manager.create({
      name: "失败任务",
      fingerprint: "result-failed-key",
      status: "FAILED",
      cwd: "C:\\Bridge",
      result_summary: "部分输出已保留",
      output_files: ["C:\\Bridge\\partial.txt"],
    });
    const manifest = new ResultService(manager).finalize(task.id);
    assert.equal(manifest.execution_status, "FAILED");
    assert.equal(manifest.review_status, "NOT_READY");
    assert.equal(manager.get(task.id).status, "FAILED");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
