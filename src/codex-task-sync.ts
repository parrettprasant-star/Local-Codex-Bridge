import {
  type RuntimeTaskLifecycleSignal,
  RuntimeStore,
} from "./runtime.js";
import {
  TaskManager,
} from "./task-manager.js";
import { TaskRuntime } from "./task-runtime.js";
import { ResultService } from "./result-service.js";

const CODEX_TASK_SOURCE = "codex-runtime";
const CODEX_EXECUTION_SOURCE = "external/native" as const;
const CODEX_TASK_TYPE = "Codex 原生任务";
const MAX_TRACKED_TURNS = 256;

interface CapturedTurn {
  threadId: string;
  turnId: string;
  taskId: string;
  waiting: boolean;
  terminal: boolean;
}

export interface CodexTaskSyncOptions {
  onError?: (error: unknown) => void;
}

function shortId(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 8);
}

function turnKey(threadId: string, turnId: string): string {
  return threadId + String.fromCharCode(0) + turnId;
}

function isSuccessfulTerminal(status: string, failed: boolean): boolean {
  if (failed) {
    return false;
  }
  return ["complete", "completed", "success", "succeeded"].includes(
    status.toLowerCase(),
  );
}

export class CodexTaskSync {
  readonly #manager: TaskManager;
  readonly #taskRuntime: TaskRuntime;
  readonly #resultService: ResultService;
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #turns = new Map<string, CapturedTurn>();
  readonly #unsubscribe: () => void;
  #closed = false;

  constructor(
    runtime: RuntimeStore,
    manager: TaskManager,
    taskRuntime: TaskRuntime,
    options: CodexTaskSyncOptions = {},
  ) {
    this.#manager = manager;
    this.#taskRuntime = taskRuntime;
    this.#resultService = new ResultService(manager);
    this.#onError = options.onError;
    this.#unsubscribe = runtime.onTaskLifecycle((signal) => {
      this.#handleSafely(signal);
    });
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#unsubscribe();
    this.#turns.clear();
  }

  #handleSafely(signal: RuntimeTaskLifecycleSignal): void {
    if (this.#closed) {
      return;
    }
    try {
      this.#handle(signal);
    } catch (error) {
      try {
        this.#onError?.(error);
      } catch {
        // Diagnostics must not affect the native Codex event path.
      }
    }
  }

  #handle(signal: RuntimeTaskLifecycleSignal): void {
    if (signal.kind === "turn_started") {
      this.#ensureTurn(signal.thread_id, signal.turn_id);
      return;
    }

    if (signal.kind === "waiting_confirm") {
      const captured = this.#ensureTurn(signal.thread_id, signal.turn_id);
      const task = this.#manager.get(captured.taskId);
      if (!captured.waiting && task.status !== "DONE" && task.status !== "FAILED") {
        this.#taskRuntime.needsConfirmation(captured.taskId, {
          stage: "等待确认",
          progress: task.progress,
          current_action: "等待审批或用户输入",
          next_action: "确认后继续执行",
          source: CODEX_TASK_SOURCE,
        });
        captured.waiting = true;
      }
      return;
    }

    if (signal.kind === "confirmation_resolved") {
      const captured = this.#turns.get(turnKey(signal.thread_id, signal.turn_id));
      if (!captured || !captured.waiting || signal.pending_count > 0) {
        return;
      }
      const task = this.#manager.get(captured.taskId);
      if (task.status !== "DONE" && task.status !== "FAILED") {
        this.#taskRuntime.confirmed(captured.taskId, {
          stage: "Codex 执行中",
          progress: task.progress,
          current_action: "确认已处理，继续执行",
          next_action: "等待执行结果",
          source: CODEX_TASK_SOURCE,
        });
      }
      captured.waiting = false;
      return;
    }

    if (signal.kind === "activity_started" || signal.kind === "activity_completed") {
      const captured = this.#ensureTurn(signal.thread_id, signal.turn_id);
      if (captured.waiting || captured.terminal) {
        return;
      }
      if (signal.kind === "activity_started") {
        this.#advance(captured, 25, "Codex 执行中", "已开始执行原生任务步骤");
      } else if (signal.agent_result) {
        this.#advance(captured, 90, "整理结果", "Codex 正在整理最终结果");
      } else {
        this.#advance(captured, 60, "处理执行结果", "原生任务步骤已完成");
      }
      return;
    }

    if (signal.kind !== "turn_completed") {
      return;
    }
    const captured = this.#ensureTurn(signal.thread_id, signal.turn_id);
    if (captured.terminal) {
      return;
    }
    if (isSuccessfulTerminal(signal.status, signal.failed)) {
      this.#taskRuntime.complete(captured.taskId, {
        stage: "已完成",
        progress: 100,
        current_action: "Codex 回合已完成",
        next_action: "无",
        result_summary: "Codex 回合已完成",
        source: CODEX_TASK_SOURCE,
      });
      // Text-only results still need a terminal review state. Finalization
      // verifies only declared outputs; it never invents files or scans history.
      try { this.#resultService.finalize(captured.taskId); } catch (error) { this.#onError?.(error); }
    } else {
      const task = this.#manager.get(captured.taskId);
      this.#taskRuntime.emit(captured.taskId, {
        type: "ERROR",
        payload: {
          stage: "执行失败",
          progress: task.progress,
          current_action: "Codex 回合异常结束",
          next_action: "检查终态后决定是否重试",
          message: "Codex 回合终态：" + signal.status,
          source: CODEX_TASK_SOURCE,
          },
        });
      if (this.#manager.get(captured.taskId).result_manifest.required_outputs.length > 0) {
        try { this.#resultService.finalize(captured.taskId); } catch (error) { this.#onError?.(error); }
      }
    }
    captured.waiting = false;
    captured.terminal = true;
    this.#trimTrackedTurns();
  }

  #ensureTurn(threadId: string, turnId: string): CapturedTurn {
    const key = turnKey(threadId, turnId);
    const existing = this.#turns.get(key);
    if (existing) {
      return existing;
    }

    const persisted = this.#manager.findByThreadTurn(threadId, turnId) ??
      this.#manager.findByFingerprint(`runtime:${threadId}:${turnId}`);
    if (persisted) {
      const persistedTask = persisted.execution_source === CODEX_EXECUTION_SOURCE &&
        (persisted.thread_id !== threadId || persisted.turn_id !== turnId || persisted.worker_id !== null)
        ? this.#manager.update(persisted.id, {
            execution_source: CODEX_EXECUTION_SOURCE,
            worker_id: null,
            thread_id: threadId,
            turn_id: turnId,
          })
        : persisted;
      const captured: CapturedTurn = {
        threadId,
        turnId,
        taskId: persistedTask.id,
        waiting: persistedTask.status === "NEED_CONFIRM",
        terminal: ["DONE", "COMPLETED", "FAILED", "INTERRUPTED"].includes(persistedTask.status),
      };
      this.#turns.set(key, captured);
      return captured;
    }

    const task = this.#manager.create({
      name: `Codex 任务 ${shortId(threadId)}/${shortId(turnId)}`,
      type: CODEX_TASK_TYPE,
      execution_source: CODEX_EXECUTION_SOURCE,
      status: "WAITING",
      progress: 0,
      stage: "任务已创建",
      current_action: "已接收原生 Codex 回合",
      next_action: "开始执行",
      fingerprint: `runtime:${threadId}:${turnId}`,
      worker_id: null,
      thread_id: threadId,
      turn_id: turnId,
      active: true,
    });
    const captured: CapturedTurn = {
      threadId,
      turnId,
      taskId: task.id,
      waiting: false,
      terminal: false,
    };
    this.#turns.set(key, captured);
    this.#taskRuntime.start(task.id, {
      stage: "Codex 执行中",
      progress: 10,
      current_action: "原生 Codex 回合执行中",
      next_action: "等待执行活动",
      source: CODEX_TASK_SOURCE,
    });
    return captured;
  }

  #advance(
    captured: CapturedTurn,
    progress: number,
    stage: string,
    message: string,
  ): void {
    const task = this.#manager.get(captured.taskId);
    if (
      task.status === "DONE" ||
      task.status === "FAILED" ||
      task.progress >= progress
    ) {
      return;
    }
    this.#taskRuntime.reportProgress(captured.taskId, {
      stage,
      progress,
      message,
      source: CODEX_TASK_SOURCE,
    });
  }

  #trimTrackedTurns(): void {
    if (this.#turns.size <= MAX_TRACKED_TURNS) {
      return;
    }
    for (const [key, captured] of this.#turns) {
      if (captured.terminal) {
        this.#turns.delete(key);
      }
      if (this.#turns.size <= MAX_TRACKED_TURNS) {
        return;
      }
    }
  }
}
