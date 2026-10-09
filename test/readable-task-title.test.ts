import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NativeStateReconciler } from "../src/native-state-reconciler.js";
import { resolveReadableTaskTitle } from "../src/readable-task-title.js";
import { RuntimeStore } from "../src/runtime.js";
import { TaskManager } from "../src/task-manager.js";

function temporaryManager(): { directory: string; manager: TaskManager } {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-readable-title-"));
  return { directory, manager: new TaskManager(join(directory, "tasks.json")) };
}

function nativeTask(manager: TaskManager, name = "Codex 任务 00000001/00000002") {
  return manager.create({
    name,
    fingerprint: "readable-title-native",
    execution_source: "external/native",
    status: "RUNNING",
    thread_id: "00000001-0000-7000-8000-000000000001",
    turn_id: "00000001-0000-7000-8000-000000000003",
    cwd: "C:\\Bridge",
    active: true,
  });
}

test("native thread name/title has highest readable-title priority", () => {
  const temporary = temporaryManager();
  try {
    const task = nativeTask(temporary.manager);
    const result = resolveReadableTaskTitle(task, {
      thread: { name: "原生线程标题", preview: "请继续执行另一个主题" },
    });
    assert.deepEqual(result, { title: "原生线程标题", source: "native" });
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("known preview extracts the readable Worker Binding title without prompt leakage", () => {
  const temporary = temporaryManager();
  try {
    const task = nativeTask(temporary.manager);
    const result = resolveReadableTaskTitle(task, {
      thread: {
        name: null,
        preview: "请在当前仓库中实施一个受控的小版本修复：Local Codex Bridge V4.2.1｜Worker Binding Fix。背景：不要继续扩展调度器。",
      },
    });
    assert.equal(result.title, "Local Codex Bridge V4.2.1｜Worker Binding Fix");
    assert.equal(result.source, "preview");
    assert.equal(result.title.includes("背景"), false);
    assert.ok(Array.from(result.title).length <= 56);
    assert.equal(result.title.includes("00000001"), false);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("first user message is used when preview is empty, then Task Store title is preserved", () => {
  const temporary = temporaryManager();
  try {
    const task = nativeTask(temporary.manager, "已有可读任务");
    const fromMessage = resolveReadableTaskTitle(task, {
      thread: { preview: null, turns: [{ items: [{ type: "userMessage", text: "请继续维护 Native State Reconciliation。" }] }] },
    });
    assert.equal(fromMessage.title, "维护 Native State Reconciliation");
    assert.equal(fromMessage.source, "preview");

    const fromTask = resolveReadableTaskTitle(task, { thread: { name: null, preview: null, turns: [] } });
    assert.deepEqual(fromTask, { title: "已有可读任务", source: "task" });
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("all title sources missing use one short safe fallback instead of thread/turn pair", () => {
  const temporary = temporaryManager();
  try {
    const task = nativeTask(temporary.manager);
    const result = resolveReadableTaskTitle(task, { thread: { name: null, title: null, preview: null, turns: [] } });
    assert.equal(result.source, "fallback");
    assert.match(result.title, /^Codex 原生任务 · 00000001$/u);
    assert.equal(result.title.includes("/"), false);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("reconciliation persists the readable title and never overwrites a Bridge task title", async () => {
  const temporary = temporaryManager();
  try {
    const external = nativeTask(temporary.manager);
    const bridge = temporary.manager.create({
      name: "Bridge 显式业务标题",
      fingerprint: "readable-title-bridge",
      execution_source: "bridge",
      status: "RUNNING",
      thread_id: "bridge-thread",
      turn_id: "bridge-turn",
      worker_id: "luna-1",
      cwd: "C:\\Bridge",
      active: false,
    });
    const reconciler = new NativeStateReconciler(
      temporary.manager,
      { async threadRead() { return { thread: { name: null, preview: "请在当前仓库中实施一个受控的小版本修复：Local Codex Bridge V4.2.1｜Worker Binding Fix。", turns: [] } }; } } as any,
      new RuntimeStore(),
    );
    await reconciler.reconcile();
    assert.equal(temporary.manager.get(external.id).name, "Local Codex Bridge V4.2.1｜Worker Binding Fix");
    assert.equal(temporary.manager.get(bridge.id).name, "Bridge 显式业务标题");
    const reloaded = new TaskManager(temporary.manager.filePath).get(external.id);
    assert.equal(reloaded.name, "Local Codex Bridge V4.2.1｜Worker Binding Fix");
    reconciler.close();
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});
