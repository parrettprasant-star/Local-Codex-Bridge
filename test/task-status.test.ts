import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexAppServerAdapter } from "../src/app-server-adapter.js";
import { CodexTaskSync } from "../src/codex-task-sync.js";
import { ModelGuard } from "../src/model-guard.js";
import { RuntimeStore } from "../src/runtime.js";
import { Scheduler } from "../src/scheduler.js";
import { TASK_EVENT_TYPES, TaskEventStream } from "../src/task-events.js";
import { TaskStatusServer, authorizedLocalFetch } from "./browser-safe-status-server.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskRuntime } from "../src/task-runtime.js";
import { TaskStatusStore } from "../src/task-status.js";

function temporaryStatusFile(): { directory: string; filePath: string; taskFilePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-status-test-"));
  return {
    directory,
    filePath: join(directory, "task_status.json"),
    taskFilePath: join(directory, "task_records.json"),
  };
}

test("runtime start and terminal timestamps persist without changing on duplicate events", () => {
  const temporary = temporaryStatusFile();
  let now = new Date("2026-10-10T00:00:00.000Z");
  try {
    const manager = new TaskManager(temporary.taskFilePath, undefined, () => now);
    const runtime = new TaskRuntime(manager);
    for (const failed of [false, true]) {
      const task = manager.create({ name: "timestamp smoke", status: "WAITING" });
      runtime.start(task.id);
      const start = manager.get(task.id).started_at;
      assert.equal(start, now.toISOString());
      now = new Date(now.getTime() + 1000);
      runtime.start(task.id);
      assert.equal(manager.get(task.id).started_at, start);
      if (failed) runtime.emit(task.id, { type: "ERROR", payload: { message: "controlled failure" } });
      else runtime.complete(task.id, { result_summary: "text-only result" });
      const terminal = manager.get(task.id).completed_at;
      assert.equal(terminal, now.toISOString());
      now = new Date(now.getTime() + 1000);
      if (failed) runtime.emit(task.id, { type: "ERROR", payload: { message: "duplicate failure" } });
      else runtime.complete(task.id);
      assert.equal(manager.get(task.id).completed_at, terminal);
      const reloaded = new TaskManager(temporary.taskFilePath).get(task.id);
      assert.equal(reloaded.started_at, start);
      assert.equal(reloaded.result_manifest.completed_at, terminal);
    }
  } finally { rmSync(temporary.directory, { recursive: true, force: true }); }
});

test("task status store keeps the bounded legacy compatibility projection", () => {
  const temporary = temporaryStatusFile();
  try {
    const firstDate = new Date("2026-08-20T01:00:00.000Z");
    const secondDate = new Date("2026-08-20T01:01:00.000Z");
    let now = firstDate;
    const store = new TaskStatusStore(temporary.filePath, () => now);
    assert.equal(store.read().progress_percent, 0);
    assert.deepEqual(JSON.parse(readFileSync(temporary.filePath, "utf8")), store.read());

    now = secondDate;
    const updated = store.update({
      task_name: "西部旅行素材整理",
      phase: "按类别归档",
      progress_percent: 45,
      completed_items: ["车辆素材", "住宿素材"],
      current_item: "道路素材",
      next_step: "核验清晰度并完成命名",
    });
    assert.equal(updated.task_name, "西部旅行素材整理");
    assert.equal(updated.progress_percent, 45);
    assert.equal(updated.updated_at, secondDate.toISOString());

    const reloaded = new TaskStatusStore(temporary.filePath, () => secondDate);
    assert.deepEqual(reloaded.read(), updated);
    assert.throws(
      () => reloaded.update({ progress_percent: 101 }),
      /progress_percent must be an integer from 0 to 100/,
    );
    assert.throws(
      () => reloaded.update({ unexpected: "must reject" }),
      /unsupported status field/,
    );
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("TaskManager V3.1 records the requested task model and state transitions", () => {
  const temporary = temporaryStatusFile();
  try {
    const firstDate = new Date("2026-08-20T02:00:00.000Z");
    const secondDate = new Date("2026-08-20T02:01:00.000Z");
    let now = firstDate;
    const statusStore = new TaskStatusStore(temporary.filePath, () => now);
    const manager = new TaskManager(temporary.taskFilePath, statusStore, () => now);
    const task = manager.create({
      name: "V3.1 素材任务",
      type: "素材整理",
      account: "示例账号C",
      skill: "素材任务Skill",
      status: "WAITING",
      stage: "等待素材",
      current_action: "尚未开始",
      next_action: "读取素材清单",
      active: true,
    });
    assert.equal(manager.snapshot().schema_version, 7);
    assert.equal(task.name, "V3.1 素材任务");
    assert.equal(task.type, "素材整理");
    assert.equal(task.account, "示例账号C");
    assert.equal(task.skill, "素材任务Skill");
    assert.equal(task.status, "WAITING");
    assert.equal(task.progress, 0);
    assert.deepEqual(task.output_files, []);
    assert.equal(task.result_summary, "");

    now = secondDate;
    const runtime = new TaskRuntime(manager);
    runtime.start(task.id, {
      stage: "读取素材",
      current_action: "扫描素材目录",
      next_action: "完成分类",
    });
    runtime.progress(task.id, { progress: 35, current_action: "分类图片" });
    const needsConfirmation = runtime.needsConfirmation(task.id, {
      message: "需要确认素材范围",
      next_action: "等待用户确认",
    });
    assert.equal(needsConfirmation.status, "NEED_CONFIRM");
    assert.equal(manager.current()?.status, "NEED_CONFIRM");

    runtime.confirmed(task.id, { message: "已确认素材范围" });
    runtime.complete(task.id, {
      stage: "交付完成",
      current_action: "完成",
      output_files: ["D:\\delivery\\result.docx"],
      result_summary: "素材任务已完成并生成交付文件",
    });
    const completed = manager.current();
    assert.equal(completed?.status, "DONE");
    assert.equal(completed?.progress, 100);
    assert.deepEqual(completed?.output_files, ["D:\\delivery\\result.docx"]);
    assert.equal(completed?.result_summary, "素材任务已完成并生成交付文件");
    assert.ok(manager.eventsForTask(task.id).some((event) => event.status === "NEED_CONFIRM"));
    assert.equal(manager.eventsForTask(task.id).at(-1)?.status, "DONE");

    const reloaded = new TaskManager(temporary.taskFilePath);
    assert.equal(reloaded.get(task.id).status, "DONE");
    assert.equal(reloaded.get(task.id).account, "示例账号C");
    assert.deepEqual(reloaded.get(task.id).output_files, ["D:\\delivery\\result.docx"]);
    assert.equal(reloaded.get(task.id).result_summary, "素材任务已完成并生成交付文件");
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("V3.2 TaskEvent stream and reportProgress update the active task", () => {
  const temporary = temporaryStatusFile();
  try {
    const firstDate = new Date("2026-08-20T02:30:00.000Z");
    const secondDate = new Date("2026-08-20T02:31:00.000Z");
    let now = firstDate;
    const manager = new TaskManager(
      temporary.taskFilePath,
      undefined,
      () => now,
    );
    const runtime = new TaskRuntime(manager);
    const stream = new TaskEventStream(manager, runtime);
    const task = manager.create({
      name: "自动进度任务",
      status: "WAITING",
      stage: "等待开始",
      active: true,
    });

    now = secondDate;
    const stageEvent = runtime.reportProgress({
      stage: "素材筛选",
      progress: 45,
      message: "正在筛选人物素材",
    });
    assert.equal(stageEvent.type, "STAGE_CHANGED");
    assert.equal(manager.get(task.id).status, "RUNNING");
    assert.equal(manager.get(task.id).stage, "素材筛选");
    assert.equal(manager.get(task.id).progress, 45);
    assert.equal(manager.get(task.id).current_action, "正在筛选人物素材");

    const progressEvent = runtime.reportProgress(task.id, {
      stage: "素材筛选",
      progress: 60,
      message: "人物素材已筛选 12 张",
      source: "worker",
    });
    assert.equal(progressEvent.type, "PROGRESS_UPDATED");

    const explicit = stream.record({
      task_id: task.id,
      type: "FILE_FOUND",
      stage: "素材筛选",
      progress: 60,
      message: "发现人物素材 13",
      source: "scanner",
    });
    assert.deepEqual(Object.keys(explicit), [
      "id",
      "task_id",
      "timestamp",
      "type",
      "stage",
      "message",
      "progress",
      "source",
    ]);
    assert.equal(explicit.type, "FILE_FOUND");
    assert.equal(explicit.source, "scanner");

    const listed = stream.list({ taskId: task.id, limit: 10 });
    assert.equal(listed.total, 4);
    assert.equal(listed.events[0]?.type, "TASK_CREATED");
    assert.equal(listed.events.at(-1)?.message, "发现人物素材 13");
    assert.deepEqual(TASK_EVENT_TYPES, [
      "TASK_CREATED",
      "TASK_STARTED",
      "STAGE_CHANGED",
      "PROGRESS_UPDATED",
      "WAITING_CONFIRM",
      "FILE_FOUND",
      "FILE_PROCESSED",
      "ERROR",
      "TASK_COMPLETED",
    ]);
    const completion = stream.record({
      task_id: task.id,
      type: "TASK_COMPLETED",
      stage: "已完成",
      progress: 100,
      message: "任务完成",
      output_files: ["D:\\delivery\\summary.txt"],
      output_directories: ["D:\\delivery"],
      result_summary: "已完成素材筛选",
      source: "worker",
    });
    assert.equal(completion.type, "TASK_COMPLETED");
    assert.deepEqual(manager.get(task.id).output_files, ["D:\\delivery\\summary.txt"]);
    assert.deepEqual(manager.get(task.id).output_directories, ["D:\\delivery"]);
    assert.deepEqual(manager.get(task.id).result_manifest.output_files, ["D:\\delivery\\summary.txt"]);
    assert.deepEqual(manager.get(task.id).result_manifest.output_directories, ["D:\\delivery"]);
    assert.equal(manager.get(task.id).result_summary, "已完成素材筛选");
    assert.throws(
      () => stream.record({ progress: 120, stage: "错误进度" }),
      /progress must be an integer from 0 to 100/,
    );
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("native Codex lifecycle events automatically update the task projection", () => {
  const temporary = temporaryStatusFile();
  const runtimeStore = new RuntimeStore();
  let sync: CodexTaskSync | undefined;
  try {
    const manager = new TaskManager(temporary.taskFilePath);
    const taskRuntime = new TaskRuntime(manager);
    const stream = new TaskEventStream(manager, taskRuntime);
    sync = new CodexTaskSync(runtimeStore, manager, taskRuntime);
    const threadId = "thread-native-status";
    const turnId = "turn-native-status";

    runtimeStore.markTurnAccepted(threadId, turnId);
    runtimeStore.recordNotification("turn/started", {
      threadId,
      turn: { id: turnId, status: "inProgress" },
    });

    assert.equal(manager.snapshot().tasks.length, 1);
    let task = manager.current();
    assert.ok(task);
    assert.match(task.name, /Codex 任务/);
    assert.equal(task.type, "Codex 原生任务");
    assert.equal(task.execution_source, "external/native");
    assert.equal(task.thread_id, threadId);
    assert.equal(task.turn_id, turnId);
    assert.equal(task.worker_id, null);
    assert.equal(task.status, "RUNNING");
    assert.equal(task.progress, 10);
    assert.equal(task.stage, "Codex 执行中");

    runtimeStore.recordNotification("item/started", {
      threadId,
      turnId,
      item: { id: "command-1", type: "commandExecution" },
    });
    assert.equal(manager.current()?.progress, 25);

    runtimeStore.recordNotification("item/completed", {
      threadId,
      turnId,
      item: { id: "command-1", type: "commandExecution" },
    });
    assert.equal(manager.current()?.progress, 60);

    assert.equal(runtimeStore.recordServerRequest(
      41,
      "item/commandExecution/requestApproval",
      { threadId, turnId, command: "bounded-test-command" },
    ), "recorded");
    assert.equal(manager.current()?.status, "NEED_CONFIRM");
    assert.equal(manager.current()?.stage, "等待确认");

    const pending = runtimeStore.claimPending(41, {
      threadId,
      turnId,
      method: "item/commandExecution/requestApproval",
    });
    runtimeStore.completePending(pending);
    assert.equal(manager.current()?.status, "RUNNING");
    assert.equal(manager.current()?.progress, 60);

    runtimeStore.recordNotification("item/completed", {
      threadId,
      turnId,
      item: { id: "message-1", type: "agentMessage", text: "NATIVE_OK" },
    });
    assert.equal(manager.current()?.progress, 90);

    runtimeStore.recordNotification("turn/completed", {
      threadId,
      turn: {
        id: turnId,
        status: "completed",
        items: [{ type: "agentMessage", text: "NATIVE_OK" }],
      },
    });
    task = manager.current();
    assert.equal(task?.status, "DONE");
    assert.equal(task?.progress, 100);
    assert.equal(task?.stage, "已完成");
    assert.deepEqual(task?.output_files, []);
    assert.equal(task?.result_summary, "Codex 回合已完成");
    assert.doesNotMatch(readFileSync(temporary.taskFilePath, "utf8"), /NATIVE_OK/);

    const events = stream.list({ taskId: task!.id, limit: 50 }).events;
    assert.equal(events[0]?.type, "TASK_CREATED");
    assert.ok(events.some((event) => event.type === "TASK_STARTED"));
    assert.ok(events.some((event) => event.type === "PROGRESS_UPDATED"));
    assert.equal(events.at(-2)?.type, "TASK_COMPLETED");
    assert.equal(events.at(-1)?.type, "STAGE_CHANGED");
    assert.equal(events.at(-1)?.source, "task-manager");
    assert.equal(events.at(-1)?.stage, "已完成");
    assert.equal(task?.result_manifest.review_status, "READY");
    assert.ok(task?.started_at);
    assert.ok(task?.completed_at);
    assert.equal(events.some((event) => event.type === "FILE_FOUND"), false);
    assert.equal(events.some((event) => event.type === "FILE_PROCESSED"), false);
    assert.ok(events.length <= 9);

    const failedTurnId = "turn-native-failed";
    runtimeStore.markTurnAccepted(threadId, failedTurnId);
    runtimeStore.markAppServerExited("bounded test failure");
    const failedTask = manager.current();
    assert.equal(failedTask?.status, "FAILED");
    assert.equal(failedTask?.stage, "执行失败");
    assert.equal(
      stream.list({ taskId: failedTask!.id, limit: 20 }).events.at(-1)?.type,
      "ERROR",
    );
  } finally {
    sync?.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("external/native auto-captured turns persist source and never occupy Bridge workers after reconcile", async () => {
  const temporary = temporaryStatusFile();
  const runtimeStore = new RuntimeStore();
  let sync: CodexTaskSync | undefined;
  let scheduler: Scheduler | undefined;
  try {
    const manager = new TaskManager(temporary.taskFilePath);
    const taskRuntime = new TaskRuntime(manager);
    sync = new CodexTaskSync(runtimeStore, manager, taskRuntime);
    const threadId = "thread-external-native";
    const turnId = "turn-external-native";
    runtimeStore.markTurnAccepted(threadId, turnId);
    runtimeStore.recordNotification("turn/started", {
      threadId,
      turn: { id: turnId, status: "inProgress" },
    });

    const captured = manager.current();
    assert.ok(captured);
    assert.equal(captured.execution_source, "external/native");
    assert.equal(captured.thread_id, threadId);
    assert.equal(captured.turn_id, turnId);
    assert.equal(captured.worker_id, null);

    const adapter = {
      async initialize() {},
      async modelList() {
        return [{
          id: "runtime-luna-id",
          model: "runtime-luna-id",
          displayName: "GPT Luna",
          supportedReasoningEfforts: ["max"],
          defaultReasoningEffort: "max",
          hidden: false,
          isDefault: true,
        }];
      },
      async threadRead() {
        throw new Error("external/native task must not be reconciled by Scheduler");
      },
    } as unknown as CodexAppServerAdapter;
    scheduler = new Scheduler(manager, adapter, new ModelGuard({ requireCatalog: true }), runtimeStore);
    await scheduler.reconcile();
    assert.equal(scheduler.snapshot().running_workers, 0);
    assert.equal(manager.get(captured.id).worker_id, null);

    scheduler.close();
    scheduler = undefined;
    sync.close();
    sync = undefined;
    const reloaded = new TaskManager(temporary.taskFilePath).get(captured.id);
    assert.equal(reloaded.execution_source, "external/native");
    assert.equal(reloaded.thread_id, threadId);
    assert.equal(reloaded.turn_id, turnId);
    assert.equal(reloaded.worker_id, null);
  } finally {
    scheduler?.close();
    sync?.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("TaskManager migrates schema v2 records once and preserves a backup", () => {
  const temporary = temporaryStatusFile();
  try {
    const legacy = {
      schema_version: 2,
      active_task_id: "legacy-task",
      tasks: [
        {
          task_id: "legacy-task",
          task_name: "旧版任务",
          status: "cancelled",
          phase: "旧阶段",
          progress_percent: 40,
          completed_items: ["旧事项"],
          current_item: "旧动作",
          next_step: "旧下一步",
          created_at: "2026-08-20T02:00:00.000Z",
          updated_at: "2026-08-20T02:01:00.000Z",
        },
      ],
      events: [
        {
          event_id: "legacy-event",
          task_id: "legacy-task",
          type: "task.cancelled",
          at: "2026-08-20T02:01:00.000Z",
          payload: {},
        },
      ],
      updated_at: "2026-08-20T02:01:00.000Z",
    };
    writeFileSync(temporary.taskFilePath, JSON.stringify(legacy), "utf8");

    const manager = new TaskManager(temporary.taskFilePath);
    const migrated = manager.current();
    assert.equal(manager.snapshot().schema_version, 7);
    assert.equal(migrated?.id, "legacy-task");
    assert.equal(migrated?.name, "旧版任务");
    assert.equal(migrated?.status, "FAILED");
    assert.equal(migrated?.progress, 40);
    assert.equal(manager.eventsForTask("legacy-task")[0]?.status, "FAILED");

    const persisted = JSON.parse(readFileSync(temporary.taskFilePath, "utf8")) as Record<string, unknown>;
    assert.equal(persisted.schema_version, 7);
    const backup = JSON.parse(
      readFileSync(temporary.taskFilePath + ".schema2.bak", "utf8"),
    ) as Record<string, unknown>;
    assert.equal(backup.schema_version, 2);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("TaskManager migrates schema v3 tasks with empty bounded result fields", () => {
  const temporary = temporaryStatusFile();
  try {
    const legacy = {
      schema_version: 3,
      active_task_id: "schema3-task",
      tasks: [
        {
          id: "schema3-task",
          name: "V3.3 原生任务",
          type: "Codex 原生任务",
          account: "",
          skill: "",
          status: "DONE",
          progress: 100,
          stage: "已完成",
          current_action: "Codex 回合已完成",
          next_action: "无",
          completed_items: [],
          created_at: "2026-08-20T02:00:00.000Z",
          updated_at: "2026-08-20T02:01:00.000Z",
        },
      ],
      events: [],
      updated_at: "2026-08-20T02:01:00.000Z",
    };
    writeFileSync(temporary.taskFilePath, JSON.stringify(legacy), "utf8");

    const manager = new TaskManager(temporary.taskFilePath);
    const migrated = manager.get("schema3-task");
    assert.equal(manager.snapshot().schema_version, 7);
    assert.deepEqual(migrated.output_files, []);
    assert.equal(migrated.result_summary, "");

    const persisted = JSON.parse(
      readFileSync(temporary.taskFilePath, "utf8"),
    ) as Record<string, unknown>;
    assert.equal(persisted.schema_version, 7);
    const backup = JSON.parse(
      readFileSync(temporary.taskFilePath + ".schema3.bak", "utf8"),
    ) as Record<string, unknown>;
    assert.equal(backup.schema_version, 3);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("status API and V4.2 result page work on loopback while accepting V3.1 interfaces", async () => {
  const temporary = temporaryStatusFile();
  const store = new TaskStatusStore(temporary.filePath);
  const manager = new TaskManager(temporary.taskFilePath, store);
  const runtime = new TaskRuntime(manager);
  const modelGuard = new ModelGuard();
  let openedDirectory: string | null = null;
  const server = new TaskStatusServer(store, manager, runtime, {
    port: 0,
    modelGuard,
    openOutputDirectory: (directory) => {
      openedDirectory = directory;
      return directory;
    },
  });
  try {
    const address = await server.start();
    const fetch = await authorizedLocalFetch(address.url);
    assert.equal(address.host, "127.0.0.1");
    assert.ok(address.port > 0);
    assert.match(address.url, /^http:\/\/127\.0\.0\.1:\d+\/status$/);

    const page = await fetch(address.url);
    assert.equal(page.status, 200);
    const pageText = await page.text();
    assert.match(pageText, /Local Codex Bridge/);
    assert.match(pageText, /模型/);
    assert.match(pageText, /任务来源/);
    assert.match(pageText, /结果摘要/);
    assert.match(pageText, /技术详情/);
    assert.match(pageText, /任务详情/);
    assert.match(pageText, /查看槽位详情/);
    assert.match(pageText, /打开输出目录/);
    assert.match(pageText, /执行中任务/);
    assert.match(pageText, /等待任务/);
    assert.match(pageText, /执行详情与实时事件日志/);
    assert.match(pageText, /最近事件/);
    assert.match(pageText, /阶段变化/);
    assert.match(pageText, /进度变化/);
    assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
    const scriptStart = pageText.indexOf("<script>") + "<script>".length;
    const scriptEnd = pageText.indexOf("</script>", scriptStart);
    assert.ok(scriptStart >= "<script>".length && scriptEnd > scriptStart);
    assert.doesNotThrow(() => new vm.Script(pageText.slice(scriptStart, scriptEnd)));

    const normalized = await fetch(`http://127.0.0.1:${address.port}/api/status`);
    assert.equal(normalized.status, 200);
    const normalizedBody = await normalized.json() as Record<string, unknown>;
    assert.ok(normalizedBody.bridge);
    assert.ok(normalizedBody.appServer === null || normalizedBody.appServer);
    assert.ok(normalizedBody.modelPolicy);
    assert.ok(normalizedBody.workers);
    assert.ok(normalizedBody.queue);
    assert.ok(normalizedBody.tasks);
    assert.ok(normalizedBody.writeClaims);
    assert.ok(normalizedBody.mcp);

    const statusUrl = `http://127.0.0.1:${address.port}/api/task-status`;
    const legacyPut = await fetch(statusUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bridge_status: "running",
        task_name: "兼容任务",
        phase: "兼容阶段",
        progress_percent: 20,
        completed_items: ["读取任务清单"],
        current_item: "兼容动作",
        next_step: "创建 V3.1 任务",
      }),
    });
    assert.equal(legacyPut.status, 200);
    const legacyBody = await legacyPut.json() as Record<string, unknown>;
    assert.equal(legacyBody.name, "兼容任务");
    assert.equal(legacyBody.task_name, "兼容任务");
    assert.equal(legacyBody.status, "RUNNING");
    assert.equal(legacyBody.progress, 20);
    assert.equal(legacyBody.progress_percent, 20);

    const tasksUrl = `http://127.0.0.1:${address.port}/api/tasks`;
    const createTask = await fetch(tasksUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "第二个任务",
        type: "图文生产",
        account: "企业号",
        skill: "企业号图文Skill",
        status: "WAITING",
        cwd: "C:\\Bridge",
        active: false,
      }),
    });
    assert.equal(createTask.status, 201);
    const createBody = await createTask.json() as Record<string, unknown>;
    assert.equal(createBody.schema_version, 7);
    const createdTask = createBody.created_task as Record<string, unknown>;
    const secondTaskId = createdTask.id as string;
    assert.ok(secondTaskId);
    assert.equal(createdTask.account, "企业号");
    assert.equal(createdTask.task_id, secondTaskId);
    const createdSession = createdTask.session as Record<string, unknown>;
    assert.equal(createdSession.taskId, secondTaskId);
    assert.equal(createdSession.taskTitle, "第二个任务");
    const sessionResponse = await fetch(`${tasksUrl}/${encodeURIComponent(secondTaskId)}/session`);
    assert.equal(sessionResponse.status, 200);
    assert.equal((await sessionResponse.json() as Record<string, unknown>).taskTitle, "第二个任务");
    const resultResponse = await fetch(`${tasksUrl}/${encodeURIComponent(secondTaskId)}/result`);
    assert.equal(resultResponse.status, 200);
    const resultBody = await resultResponse.json() as Record<string, unknown>;
    assert.equal((resultBody.result_manifest as Record<string, unknown>).task_id, secondTaskId);

    const taskUpdate = await fetch(`${tasksUrl}/${encodeURIComponent(secondTaskId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "RUNNING", progress: 10, stage: "初始化" }),
    });
    assert.equal(taskUpdate.status, 200);
    assert.equal((await taskUpdate.json() as Record<string, unknown>).status, "RUNNING");

    const handoffUpdate = await fetch(`${tasksUrl}/${encodeURIComponent(secondTaskId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        output_files: ["C:\\Bridge\\result.txt"],
        output_directories: ["c:/Bridge/out/"],
        result_summary: "已生成交付结果",
      }),
    });
    assert.equal(handoffUpdate.status, 200);
    const handoffTask = await handoffUpdate.json() as Record<string, unknown>;
    assert.deepEqual(handoffTask.output_directories, ["c:/Bridge/out/"]);

    const openOutput = await fetch(`${tasksUrl}/${encodeURIComponent(secondTaskId)}/open-output-directory`, {
      method: "POST",
    });
    assert.equal(openOutput.status, 200);
    assert.equal(openedDirectory, "c:\\Bridge\\out");

    const activate = await fetch(`${tasksUrl}/${encodeURIComponent(secondTaskId)}/activate`, {
      method: "POST",
    });
    assert.equal(activate.status, 200);
    assert.equal((await activate.json() as Record<string, unknown>).active_task_id, secondTaskId);

    const taskEventsUrl = `http://127.0.0.1:${address.port}/api/task-events`;
    const progressReport = await fetch(taskEventsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stage: "素材筛选",
        progress: 45,
        message: "正在筛选人物素材",
        source: "api-test",
      }),
    });
    assert.equal(progressReport.status, 201);
    const progressBody = await progressReport.json() as Record<string, unknown>;
    const progressEvent = progressBody.event as Record<string, unknown>;
    assert.equal(progressEvent.task_id, secondTaskId);
    assert.equal(progressEvent.type, "STAGE_CHANGED");
    assert.equal(progressEvent.stage, "素材筛选");
    assert.equal(progressEvent.progress, 45);
    assert.equal(progressEvent.message, "正在筛选人物素材");
    assert.equal(progressEvent.source, "api-test");
    assert.equal((progressBody.task as Record<string, unknown>).progress, 45);

    const fileFound = await fetch(taskEventsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task_id: secondTaskId,
        type: "FILE_FOUND",
        stage: "素材筛选",
        progress: 45,
        message: "发现道路素材 08",
        source: "scanner",
      }),
    });
    assert.equal(fileFound.status, 201);
    assert.equal(
      ((await fileFound.json() as Record<string, unknown>).event as Record<string, unknown>).type,
      "FILE_FOUND",
    );

    const publicEvents = await fetch(
      `${taskEventsUrl}?task_id=${encodeURIComponent(secondTaskId)}&limit=10`,
    );
    assert.equal(publicEvents.status, 200);
    const publicEventsBody = await publicEvents.json() as Record<string, unknown>;
    assert.equal(publicEventsBody.task_id, secondTaskId);
    assert.ok((publicEventsBody.events as unknown[]).length >= 4);
    assert.equal(
      (publicEventsBody.latest_event as Record<string, unknown>).type,
      "FILE_FOUND",
    );

    const eventPost = await fetch(`${tasksUrl}/${encodeURIComponent(secondTaskId)}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "task.needs_confirmation",
        payload: {
          progress: 55,
          stage: "用户确认",
          current_action: "等待确认路线",
          next_action: "确认后继续执行",
          message: "需要确认路线范围",
        },
      }),
    });
    assert.equal(eventPost.status, 201);
    const eventBody = await eventPost.json() as Record<string, unknown>;
    assert.equal((eventBody.event as Record<string, unknown>).status, "NEED_CONFIRM");
    assert.equal((eventBody.task as Record<string, unknown>).status, "NEED_CONFIRM");

    const eventList = await fetch(`${tasksUrl}/${encodeURIComponent(secondTaskId)}/events?limit=10`);
    assert.equal(eventList.status, 200);
    const eventListBody = await eventList.json() as Record<string, unknown>;
    assert.ok((eventListBody.events as unknown[]).length >= 3);

    const collection = await fetch(tasksUrl);
    const collectionBody = await collection.json() as Record<string, unknown>;
    assert.equal(collectionBody.schema_version, 7);
    assert.equal(collectionBody.current_execution_model, "gpt-5.6-luna");
    assert.equal(collectionBody.current_reasoning_effort, "max");
    assert.equal(collectionBody.quota_mode, "protected");
    assert.equal(collectionBody.model_policy_status, "active");
    assert.equal((collectionBody.tasks as unknown[]).length, 2);
    assert.equal((collectionBody.current_task as Record<string, unknown>).id, secondTaskId);
    assert.equal((collectionBody.current_task as Record<string, unknown>).status, "NEED_CONFIRM");

    const manualDecision = modelGuard.evaluate({ requested_model: "gpt-5.6-luna" });
    assert.equal(manualDecision.allowed, true);
    if (!manualDecision.allowed) throw new Error("expected an allowed Terra decision");
    modelGuard.markAccepted(manualDecision);
    const updatedModelBody = await (await fetch(tasksUrl)).json() as Record<string, unknown>;
    assert.equal(updatedModelBody.current_execution_model, "gpt-5.6-luna");
    assert.equal(updatedModelBody.current_reasoning_effort, "max");
    assert.equal(updatedModelBody.quota_mode, "protected");
    assert.equal(updatedModelBody.model_policy_status, "active");

    const invalid = await fetch(`${tasksUrl}/${encodeURIComponent(secondTaskId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progress: 120 }),
    });
    assert.equal(invalid.status, 400);

    const missing = await fetch(`http://127.0.0.1:${address.port}/missing`);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});
