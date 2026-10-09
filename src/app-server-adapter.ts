import {
  AppServerManager,
  AppServerRequestError,
  type AppServerStatus,
} from "./app-server.js";

export interface AppServerModel {
  id: string;
  model: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
  hidden: boolean;
  isDefault: boolean;
}

export interface AppServerThreadResult {
  thread_id: string;
  model: string | null;
  model_provider: string | null;
  reasoning_effort: string | null;
  raw: Record<string, unknown>;
}

export interface AppServerTurnResult {
  turn_id: string;
  status: string;
  model: string | null;
  reasoning_effort: string | null;
  raw: Record<string, unknown>;
}

export interface AppServerAdapterHealth {
  status: AppServerStatus;
  model_catalog: "unknown" | "available" | "unavailable";
  last_model_catalog_at: string | null;
  last_error: string | null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseModels(result: unknown): AppServerModel[] {
  const root = record(result, "model/list result");
  if (!Array.isArray(root.data)) {
    throw new Error("model/list returned no data array");
  }
  return root.data.map((candidate, index) => {
    const model = record(candidate, `model/list.data[${index}]`);
    const id = stringValue(model.id) ?? stringValue(model.model);
    if (!id) {
      throw new Error(`model/list.data[${index}] returned no model id`);
    }
    const supported = Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
        .map((option) => record(option, "reasoning effort option").reasoningEffort)
        .filter((effort): effort is string => typeof effort === "string")
      : [];
    return {
      id,
      model: stringValue(model.model) ?? id,
      displayName: stringValue(model.displayName) ?? id,
      supportedReasoningEfforts: supported,
      defaultReasoningEffort: stringValue(model.defaultReasoningEffort) ?? "",
      hidden: model.hidden === true,
      isDefault: model.isDefault === true,
    };
  });
}

function parseThread(result: unknown, method: string): AppServerThreadResult {
  const root = record(result, `${method} result`);
  const thread = record(root.thread, `${method}.thread`);
  const threadId = stringValue(thread.id);
  if (!threadId) {
    throw new Error(`${method} returned no thread id`);
  }
  return {
    thread_id: threadId,
    model: stringValue(root.model),
    model_provider: stringValue(root.modelProvider),
    reasoning_effort: stringValue(root.reasoningEffort),
    raw: root,
  };
}

function parseTurn(result: unknown): AppServerTurnResult {
  const root = record(result, "turn/start result");
  const turn = record(root.turn, "turn/start.turn");
  const turnId = stringValue(turn.id);
  if (!turnId) {
    throw new Error("turn/start returned no turn id");
  }
  return {
    turn_id: turnId,
    status: stringValue(turn.status) ?? "inProgress",
    model: stringValue(turn.model),
    reasoning_effort: stringValue(turn.reasoningEffort),
    raw: root,
  };
}

export function isServerOverloaded(error: unknown): boolean {
  if (!(error instanceof AppServerRequestError)) {
    return false;
  }
  if (error.rpcCode === -32001 || error.rpcCode === "-32001") {
    return true;
  }
  const text = JSON.stringify(error.data ?? "");
  return /serverOverloaded|server overloaded|overloaded|rate.?limit/i.test(text);
}

export class CodexAppServerAdapter {
  readonly #manager: AppServerManager;
  #models: AppServerModel[] | null = null;
  #lastModelCatalogAt: string | null = null;
  #lastError: string | null = null;

  constructor(manager: AppServerManager) {
    this.#manager = manager;
  }

  async initialize(): Promise<void> {
    await this.#manager.ensureReady();
  }

  async modelList(refresh = false): Promise<readonly AppServerModel[]> {
    await this.initialize();
    if (this.#models && !refresh) {
      return this.#models.map((model) => ({ ...model, supportedReasoningEfforts: [...model.supportedReasoningEfforts] }));
    }
    try {
      const result = await this.#manager.request("model/list", {});
      this.#models = parseModels(result);
      this.#lastModelCatalogAt = new Date().toISOString();
      this.#lastError = null;
      return this.#models.map((model) => ({ ...model, supportedReasoningEfforts: [...model.supportedReasoningEfforts] }));
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async threadStart(params: Record<string, unknown>): Promise<AppServerThreadResult> {
    return parseThread(await this.#manager.request("thread/start", params), "thread/start");
  }

  async threadResume(threadId: string, params: Record<string, unknown> = {}): Promise<AppServerThreadResult> {
    return parseThread(
      await this.#manager.request("thread/resume", { threadId, ...params }),
      "thread/resume",
    );
  }

  async threadRead(threadId: string, includeTurns = true): Promise<Record<string, unknown>> {
    return record(
      await this.#manager.request("thread/read", { threadId, includeTurns }),
      "thread/read result",
    );
  }

  async threadList(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return record(await this.#manager.request("thread/list", params), "thread/list result");
  }

  async turnStart(params: Record<string, unknown>): Promise<AppServerTurnResult> {
    return parseTurn(await this.#manager.request("turn/start", params));
  }

  async turnInterrupt(threadId: string, turnId: string): Promise<Record<string, unknown>> {
    return record(
      await this.#manager.request("turn/interrupt", { threadId, turnId }),
      "turn/interrupt result",
    );
  }

  async turnSteer(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return record(await this.#manager.request("turn/steer", params), "turn/steer result");
  }

  async respond(id: string | number, result: unknown): Promise<void> {
    await this.#manager.respond(id, result);
  }

  health(): AppServerAdapterHealth {
    return {
      status: this.#manager.status(),
      model_catalog: this.#models ? "available" : this.#lastError ? "unavailable" : "unknown",
      last_model_catalog_at: this.#lastModelCatalogAt,
      last_error: this.#lastError,
    };
  }
}
