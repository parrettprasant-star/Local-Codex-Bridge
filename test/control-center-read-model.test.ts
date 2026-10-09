import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlCenterState,
  formatRelativeTimestamp,
  normalizeNativeThreadRecord,
  normalizeTimestamp,
  shortenWindowsPath,
} from "../src/control-center-read-model.js";

test("timestamp normalization accepts Unix seconds, milliseconds, invalid, and null values", () => {
  assert.equal(normalizeTimestamp(1_700_000_000), 1_700_000_000_000);
  assert.equal(normalizeTimestamp(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(normalizeTimestamp("1700000000"), 1_700_000_000_000);
  assert.equal(normalizeTimestamp("not-a-timestamp"), null);
  assert.equal(normalizeTimestamp(null), null);
  assert.equal(normalizeTimestamp({ updatedAt: 1_700_000_000 }), 1_700_000_000_000);
});

test("relative timestamps stay readable instead of rendering epoch seconds as days", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");
  assert.equal(formatRelativeTimestamp(now - 11_000, now), "11秒前");
  assert.equal(formatRelativeTimestamp(now - 3 * 60_000, now), "3分钟前");
  assert.equal(formatRelativeTimestamp(now - 2 * 60 * 60_000, now), "2小时前");
  assert.equal(formatRelativeTimestamp("2026-08-27T12:00:00.000Z", now), "昨天");
  assert.equal(formatRelativeTimestamp("2026-08-08T12:00:00.000Z", now), "8月8日");
  assert.equal(formatRelativeTimestamp("invalid", now), "未报告");
  assert.equal(formatRelativeTimestamp(null, now), "未报告");
});

test("native thread metadata extracts scalar fields and never exposes object coercion", () => {
  const normalized = normalizeNativeThreadRecord({
    id: "thread-ui-1",
    title: { value: "BRIDGE_VISIBILITY_TEST_OK" },
    status: { type: "idle" },
    source: { type: "native-codex" },
    cwd: { path: "C:\\Users\\测试用户\\Desktop\\Bridge codex" },
    model: { id: "gpt-5.6-luna", provider: "openai" },
    gitInfo: { branch: "main" },
    updatedAt: 1_700_000_000,
  });
  assert.equal(normalized.id, "thread-ui-1");
  assert.equal(normalized.title, "BRIDGE_VISIBILITY_TEST_OK");
  assert.equal(normalized.status, "idle");
  assert.equal(normalized.source, "native-codex");
  assert.equal(normalized.cwd, "C:\\Users\\测试用户\\Desktop\\Bridge codex");
  assert.equal(normalized.model, "gpt-5.6-luna");
  assert.equal(normalized.gitInfo, "main");
  assert.equal(JSON.stringify(normalized).includes("[object Object]"), false);
  assert.equal(shortenWindowsPath(normalized.cwd, 24)?.includes("…"), true);
});

test("ControlCenterState shares ready status and treats lazy Codex as waiting, not disconnected", () => {
  const ready = buildControlCenterState({
    updated_at: "2026-08-28T12:00:00.000Z",
    bridge: { status: "running" },
    appServer: { process_state: "running" },
    tunnel: { status: "running", registration: "ready" },
    plugin_bridge: { status: "ready", transport: "tunnel" },
    native_session_transport: { status: "ready" },
    agents: { active_jobs: 1, queued_jobs: 2, max_jobs: 5 },
    workers: { running: 1, bridge_running: 1, native_active: 1, max: 5 },
    queue: { depth: 2 },
    tasks: {
      active: [{ id: "native-task", execution_source: "external/native", thread_id: "thread-ui-1" }],
      pending_confirmations: [],
      items: [],
    },
  });
  assert.equal(ready.source, "normalized_status");
  assert.equal(ready.bridge.state, "connected");
  assert.equal(ready.tunnel.state, "ready");
  assert.equal(ready.tunnel.registration, "ready");
  assert.equal(ready.plugin.state, "ready");
  assert.equal(ready.codex.state, "ready");
  assert.equal(ready.activeNativeTurns.length, 1);
  assert.deepEqual(ready.agentJobs, { running: 1, queued: 2, max: 5, recentFailures: 0 });

  const lazy = buildControlCenterState({
    appServer: { process_state: "not_started" },
    native_session_transport: { status: "disconnected" },
  });
  assert.equal(lazy.codex.state, "waiting");
  assert.equal(lazy.codex.label, "待启动");
});
