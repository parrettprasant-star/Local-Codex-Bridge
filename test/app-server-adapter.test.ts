import assert from "node:assert/strict";
import test from "node:test";

import {
  AppServerManager,
  AppServerRequestError,
} from "../src/app-server.js";
import {
  CodexAppServerAdapter,
  isServerOverloaded,
} from "../src/app-server-adapter.js";
import { RuntimeStore } from "../src/runtime.js";

class StubAppServer extends AppServerManager {
  readonly calls: Array<{ method: string; params: unknown }> = [];

  constructor() {
    super(new RuntimeStore(), { executable: "unused" });
  }

  override async ensureReady(): Promise<void> {}

  override async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "model/list") {
      return {
        data: [{
          id: "provider-luna-actual-id",
          model: "provider-luna-actual-id",
          displayName: "Luna",
          supportedReasoningEfforts: [{ reasoningEffort: "max", description: "maximum" }],
          defaultReasoningEffort: "max",
          hidden: false,
          isDefault: true,
        }],
        nextCursor: null,
      };
    }
    if (method === "thread/start") {
      return { thread: { id: "thread-1" }, model: "provider-luna-actual-id", reasoningEffort: "max", sandbox: { type: "workspaceWrite" } };
    }
    if (method === "turn/start") {
      return { turn: { id: "turn-1", status: "inProgress" } };
    }
    if (method === "thread/read") {
      return { thread: { id: "thread-1", turns: [{ id: "turn-1", status: "inProgress" }] } };
    }
    if (method === "turn/interrupt") return {};
    throw new Error(`unexpected ${method}`);
  }
}

test("App Server adapter uses generated model/list shape and typed lifecycle wrappers", async () => {
  const manager = new StubAppServer();
  const adapter = new CodexAppServerAdapter(manager);
  const models = await adapter.modelList();
  assert.equal(models[0]?.id, "provider-luna-actual-id");
  const thread = await adapter.threadStart({ cwd: "C:\\Bridge", model: "provider-luna-actual-id" });
  assert.equal(thread.thread_id, "thread-1");
  const turn = await adapter.turnStart({ threadId: thread.thread_id, input: [] });
  assert.equal(turn.turn_id, "turn-1");
  assert.equal((await adapter.threadRead(thread.thread_id)).thread !== undefined, true);
  await adapter.turnInterrupt(thread.thread_id, turn.turn_id);
  assert.deepEqual(manager.calls.map((call) => call.method), ["model/list", "thread/start", "turn/start", "thread/read", "turn/interrupt"]);
});

test("overloaded app-server errors are classified without model fallback", () => {
  const error = new AppServerRequestError("turn/start", "Server overloaded", -32001, { code: "serverOverloaded" });
  assert.equal(isServerOverloaded(error), true);
  assert.equal(isServerOverloaded(new Error("Sol is not a retry strategy")), false);
});
