import assert from "node:assert/strict";
import test from "node:test";

import { AppServerManager } from "../src/app-server.js";
import { RuntimeStore } from "../src/runtime.js";
import { ControlSurface, TOOL_DEFINITIONS } from "../src/tools.js";

interface CapturedRequest {
  method: string;
  params: unknown;
}

class StubAppServerManager extends AppServerManager {
  readonly requests: CapturedRequest[] = [];

  constructor(
    private readonly handleRequest: (method: string, params: unknown) => unknown,
  ) {
    super(new RuntimeStore(), { executable: "unused-test-codex" });
  }

  override async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    return this.handleRequest(method, params);
  }
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function propertySchema(toolName: string, propertyName: string): Record<string, unknown> {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === toolName);
  assert.ok(tool, `missing tool definition ${toolName}`);
  const properties = object(tool.inputSchema.properties);
  return object(properties[propertyName]);
}

test("codex_turn forwards each requested raw sandbox and the exact returned native policy", async (t) => {
  const cases = [
    {
      requested: "read-only",
      policy: { type: "readOnly" },
    },
    {
      requested: "workspace-write",
      policy: {
        type: "workspaceWrite",
        writableRoots: ["D:\\work", "D:\\shared"],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: true,
      },
    },
    {
      requested: "danger-full-access",
      policy: { type: "dangerFullAccess" },
    },
  ] as const;

  for (const { requested, policy } of cases) {
    await t.test(requested, async () => {
      const manager = new StubAppServerManager((method) => {
        if (method === "thread/start") {
          return { thread: { id: `thread-${requested}` }, sandbox: policy };
        }
        if (method === "turn/start") {
          return { turn: { id: `turn-${requested}`, status: "inProgress" } };
        }
        throw new Error(`unexpected request ${method}`);
      });
      const surface = new ControlSurface(manager);

      await surface.call("codex_turn", {
        text: "test turn",
        cwd: "D:\\work",
        sandbox: requested,
      });

      assert.equal(manager.requests.length, 2);
      assert.equal(manager.requests[0]?.method, "thread/start");
      assert.deepEqual(object(manager.requests[0]?.params), {
        cwd: "D:\\work",
        model: "gpt-5.6-luna",
        sandbox: requested,
        serviceName: "local-codex-bridge",
      });
      assert.equal(manager.requests[1]?.method, "turn/start");
      const turnParams = object(manager.requests[1]?.params);
      assert.equal(turnParams.model, "gpt-5.6-luna");
      assert.equal(turnParams.effort, "max");
      assert.strictEqual(turnParams.sandboxPolicy, policy);
      assert.deepEqual(turnParams.sandboxPolicy, policy);
    });
  }
});

test("codex_turn uses the newly resolved policy when the same thread changes sandbox", async () => {
  const workspacePolicy = {
    type: "workspaceWrite",
    writableRoots: ["D:\\work"],
    networkAccess: false,
  };
  const readOnlyPolicy = { type: "readOnly" };
  let turnNumber = 0;
  const manager = new StubAppServerManager((method) => {
    if (method === "thread/start") {
      return { thread: { id: "thread-shared" }, sandbox: workspacePolicy };
    }
    if (method === "thread/resume") {
      return { thread: { id: "thread-shared" }, sandbox: readOnlyPolicy };
    }
    if (method === "turn/start") {
      turnNumber += 1;
      return { turn: { id: `turn-${turnNumber}`, status: "inProgress" } };
    }
    throw new Error(`unexpected request ${method}`);
  });
  const surface = new ControlSurface(manager);

  await surface.call("codex_turn", {
    text: "first",
    cwd: "D:\\work",
    sandbox: "workspace-write",
  });
  await surface.call("codex_turn", {
    text: "second",
    thread_id: "thread-shared",
    sandbox: "read-only",
  });

  assert.deepEqual(manager.requests.map((request) => request.method), [
    "thread/start",
    "turn/start",
    "thread/resume",
    "turn/start",
  ]);
  assert.strictEqual(object(manager.requests[1]?.params).sandboxPolicy, workspacePolicy);
  assert.deepEqual(object(manager.requests[2]?.params), {
    threadId: "thread-shared",
    model: "gpt-5.6-luna",
    sandbox: "read-only",
  });
  assert.strictEqual(object(manager.requests[3]?.params).sandboxPolicy, readOnlyPolicy);
});

test("codex_turn stops high-complexity automatic work before app-server calls", async () => {
  const manager = new StubAppServerManager((method) => {
    throw new Error(`unexpected request ${method}`);
  });
  const surface = new ControlSurface(manager);

  const result = await surface.call("codex_turn", {
    text: "high complexity task",
    cwd: "D:\\work",
    task_type: "future-template",
    task_complexity: "high",
  });
  const response = object(result);
  assert.equal(response.accepted, false);
  assert.equal(response.status, "confirmation_required");
  assert.equal(response.execution_mode, "model-guard");
  assert.equal(response.reason, "high-complexity-requires-manual-model-confirmation");
  assert.equal(manager.requests.length, 0);
  const guard = object(response.model_guard);
  assert.equal(guard.suggested_model, "gpt-5.6-luna");
  assert.equal(guard.suggested_effort, "max");
});

test("codex_turn blocks an explicit Terra model under Luna Max Only", async () => {
  const manager = new StubAppServerManager((method) => {
    throw new Error(`unexpected request ${method}`);
  });
  const surface = new ControlSurface(manager);

  const result = await surface.call("codex_turn", {
    text: "manually confirmed complex task",
    cwd: "D:\\work",
    model: "gpt-5.6-terra",
    task_complexity: "high",
  });
  const response = object(result);
  assert.equal(response.accepted, false);
  assert.equal(response.status, "blocked");
  assert.equal(response.reason, "model-not-luna");
  assert.equal(manager.requests.length, 0);
  const guard = object(response.model_guard);
  assert.equal(guard.reason, "model-not-luna");
});

test("codex_turn reports a successful idle-thread resume without claiming Desktop attachment", async () => {
  const manager = new StubAppServerManager((method) => {
    if (method === "thread/resume") {
      return { thread: { id: "thread-idle" } };
    }
    if (method === "turn/start") {
      return { turn: { id: "turn-idle", status: "inProgress" } };
    }
    throw new Error(`unexpected request ${method}`);
  });
  const surface = new ControlSurface(manager);

  const result = await surface.call("codex_turn", {
    text: "resume idle thread",
    thread_id: "thread-idle",
  });
  const response = object(result);
  assert.equal(response.accepted, true);
  assert.equal(response.execution_mode, "resumed");
  assert.equal(response.desktop_ui_visibility, "not_attached");
  const threadStatus = object(response.thread_status);
  assert.equal(threadStatus.bridge_runtime, "live");
  assert.equal(threadStatus.ownership, "bridge");
  assert.equal(threadStatus.busy, true);
  const appServer = object(response.app_server);
  assert.equal(appServer.transport, "stdio");
  assert.equal(appServer.attachable, false);
  assert.equal(appServer.desktop_ui_visibility, "not_attached");
});

test("codex_turn returns structured busy without shadow-resuming an externally occupied thread", async () => {
  const manager = new StubAppServerManager((method) => {
    if (method === "thread/resume") {
      throw new Error("Codex app-server thread/resume failed: session write lock is busy and owned by another runtime");
    }
    throw new Error(`unexpected request ${method}`);
  });
  const surface = new ControlSurface(manager);

  const result = await surface.call("codex_turn", {
    text: "must stay on the original thread",
    thread_id: "thread-desktop-owned",
  });
  const response = object(result);
  assert.equal(response.accepted, false);
  assert.equal(response.status, "busy");
  assert.equal(response.execution_mode, "busy");
  assert.equal(response.thread_id, "thread-desktop-owned");
  assert.equal(response.reason, "native_resume_rejected_busy");
  const threadStatus = object(response.thread_status);
  assert.equal(threadStatus.ownership, "external_runtime_or_client");
  assert.equal(threadStatus.busy, true);
  assert.deepEqual(manager.requests.map((request) => request.method), ["thread/resume"]);
  const fallback = object(response.fresh_fallback);
  assert.equal(fallback.requested, false);
  assert.equal(fallback.available, false);
  assert.deepEqual(fallback.requires, ["cwd"]);
});

test("codex_turn treats the native active-writer resume error as busy by default", async () => {
  const manager = new StubAppServerManager((method) => {
    if (method === "thread/resume") {
      throw new Error(
        "Codex app-server thread/resume failed: thread 019ff3e7-19ef-7a21-8906-e2f350393a78 already has an active writer",
      );
    }
    throw new Error(`unexpected request ${method}`);
  });
  const surface = new ControlSurface(manager);

  const result = await surface.call("codex_turn", {
    text: "resume the Desktop-owned thread",
    thread_id: "019ff3e7-19ef-7a21-8906-e2f350393a78",
  });
  const response = object(result);
  assert.equal(response.accepted, false);
  assert.equal(response.status, "busy");
  assert.equal(response.execution_mode, "busy");
  assert.equal(response.reason, "native_resume_rejected_busy");
  assert.deepEqual(manager.requests.map((request) => request.method), ["thread/resume"]);
  const fallback = object(response.fresh_fallback);
  assert.equal(fallback.requested, false);
  assert.equal(fallback.available, false);
});

test("codex_turn only uses a fresh fallback after the caller explicitly opts in", async () => {
  const manager = new StubAppServerManager((method) => {
    if (method === "thread/resume") {
      throw new Error("thread is locked by another client");
    }
    if (method === "thread/start") {
      return { thread: { id: "thread-fresh" } };
    }
    if (method === "turn/start") {
      return { turn: { id: "turn-fresh", status: "inProgress" } };
    }
    throw new Error(`unexpected request ${method}`);
  });
  const surface = new ControlSurface(manager);

  const result = await surface.call("codex_turn", {
    text: "continue in a separate thread only by explicit choice",
    thread_id: "thread-desktop-owned",
    cwd: "D:\\Bridge",
    on_busy: "fresh",
  });
  const response = object(result);
  assert.equal(response.accepted, true);
  assert.equal(response.execution_mode, "fresh-fallback");
  assert.equal(response.requested_thread_id, "thread-desktop-owned");
  assert.equal(response.thread_id, "thread-fresh");
  assert.deepEqual(manager.requests.map((request) => request.method), [
    "thread/resume",
    "thread/start",
    "turn/start",
  ]);
});

test("codex_turn omits turn-level sandboxPolicy when sandbox was not requested", async () => {
  const manager = new StubAppServerManager((method) => {
    if (method === "thread/start") {
      return {
        thread: { id: "thread-default" },
        sandbox: { type: "workspaceWrite", writableRoots: ["D:\\work"] },
      };
    }
    if (method === "turn/start") {
      return { turn: { id: "turn-default", status: "inProgress" } };
    }
    throw new Error(`unexpected request ${method}`);
  });
  const surface = new ControlSurface(manager);

  await surface.call("codex_turn", { text: "default sandbox", cwd: "D:\\work" });

  assert.equal("sandbox" in object(manager.requests[0]?.params), false);
  assert.equal("sandboxPolicy" in object(manager.requests[1]?.params), false);
});

test("codex_turn fails closed before turn/start for unusable returned sandbox policies", async (t) => {
  const invalidPolicies: Array<{ name: string; includeSandbox: boolean; value?: unknown }> = [
    { name: "missing", includeSandbox: false },
    { name: "non-object", includeSandbox: true, value: "workspaceWrite" },
    { name: "array", includeSandbox: true, value: [{ type: "workspaceWrite" }] },
    { name: "missing discriminator", includeSandbox: true, value: {} },
    { name: "unknown discriminator", includeSandbox: true, value: { type: "futurePolicy" } },
    { name: "mismatched discriminator", includeSandbox: true, value: { type: "readOnly" } },
  ];

  for (const invalid of invalidPolicies) {
    await t.test(invalid.name, async () => {
      const manager = new StubAppServerManager((method) => {
        if (method !== "thread/start") {
          throw new Error(`unexpected request ${method}`);
        }
        return {
          thread: { id: "thread-invalid" },
          ...(invalid.includeSandbox ? { sandbox: invalid.value } : {}),
        };
      });
      const surface = new ControlSurface(manager);

      await assert.rejects(
        surface.call("codex_turn", {
          text: "must not start",
          cwd: "D:\\work",
          sandbox: "workspace-write",
        }),
        /sandbox/,
      );
      assert.deepEqual(manager.requests.map((request) => request.method), ["thread/start"]);
    });
  }
});

test("public tool schemas expose the same string bounds already enforced at runtime", () => {
  const expected: Array<[string, string, number]> = [
    ["codex_threads", "thread_id", 200],
    ["codex_threads", "cwd", 1_000],
    ["codex_threads", "cursor", 10_000],
    ["codex_turn", "thread_id", 200],
    ["codex_turn", "cwd", 1_000],
    ["codex_turn", "task_type", 100],
    ["codex_observe", "thread_id", 200],
    ["codex_steer", "thread_id", 200],
    ["codex_steer", "expected_turn_id", 200],
    ["codex_respond", "thread_id", 200],
    ["codex_respond", "turn_id", 200],
    ["codex_respond", "method", 300],
    ["codex_interrupt", "thread_id", 200],
    ["codex_interrupt", "turn_id", 200],
  ];

  for (const [tool, property, maxLength] of expected) {
    assert.equal(
      propertySchema(tool, property).maxLength,
      maxLength,
      `${tool}.${property}`,
    );
  }
});
