import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { AppServerManager } from "../src/app-server.js";
import { ControlSurface } from "../src/tools.js";

const fakeCodex = fileURLToPath(new URL("../../test/fake-codex.mjs", import.meta.url));

test("Plugin native facade covers thread/list, persistent turn, observe, read, and reconnect", async () => {
  const manager = new AppServerManager(undefined, {
    executable: process.execPath,
    prefixArgs: [fakeCodex],
    requestTimeoutMs: 2_000,
  });
  const control = new ControlSurface(manager);
  try {
    const listed = await control.call("codex_threads", { limit: 5 }) as Record<string, unknown>;
    assert.equal(listed.source, "codex_app_server");
    assert.equal(Array.isArray(listed.data), true);

    const started = await control.call("codex_turn", {
      text: "Plugin native integration read-only turn",
      cwd: "D:\\Bridge",
      sandbox: "read-only",
      approval_policy: "never",
    }) as Record<string, unknown>;
    assert.equal(started.accepted, true);
    assert.equal(started.execution_source, "external/native");
    assert.equal(typeof started.thread_id, "string");
    assert.equal(typeof started.turn_id, "string");

    const threadId = started.thread_id as string;
    const turnId = started.turn_id as string;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const observed = await control.call("codex_observe", { thread_id: threadId, cursor: 0, limit: 20 }) as Record<string, unknown>;
    assert.equal(Array.isArray(observed.pending_requests), true);
    const pending = (observed.pending_requests as Array<Record<string, unknown>>)[0];
    if (pending) {
      await control.call("codex_respond", {
        request_id: pending.request_id,
        thread_id: pending.thread_id,
        turn_id: pending.turn_id,
        method: pending.method,
        decision: "decline",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    const terminal = await control.call("codex_observe", { thread_id: threadId, cursor: 0, limit: 20 }) as Record<string, unknown>;
    assert.equal((terminal.terminal as Record<string, unknown>)?.final_result, "FAKE_FINAL");

    const read = await control.call("codex_threads", { thread_id: threadId, include_turns: true }) as Record<string, unknown>;
    assert.equal((read.thread as Record<string, unknown>)?.id, threadId);

    await assert.rejects(manager.request("test/exit", {}), /exited unexpectedly/);
    for (let restart = 0; restart < 3; restart += 1) {
      const afterRestart = await control.call("codex_threads", { limit: 1 }) as Record<string, unknown>;
      assert.equal(Array.isArray(afterRestart.data), true);
      assert.equal(manager.status().process_state, "running");
      if (restart < 2) await assert.rejects(manager.request("test/exit", {}), /exited unexpectedly/);
    }
  } finally {
    await manager.close();
  }
});
