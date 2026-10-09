import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEphemeralExecArgs,
  detectCodexCapabilities,
  extractFinalAnswer,
  JsonlEventParser,
  normalizeEphemeralEvent,
  type CodexCapabilitySnapshot,
  type EphemeralCodexRunRequest,
  type EphemeralRunnerEvent,
} from "../src/ephemeral-codex-runner.js";

const request: EphemeralCodexRunRequest = {
  cwd: "C:\\Bridge",
  prompt: "read only probe",
  model: "gpt-5.6-luna",
  effort: "max",
  sandbox: "read-only",
  approval_policy: "on-request",
};

function capabilities(overrides: Partial<CodexCapabilitySnapshot> = {}): CodexCapabilitySnapshot {
  return {
    executable: "codex",
    version: "0.148.0",
    detected_at: "2026-08-27T00:00:00.000Z",
    supports_ephemeral_exec: true,
    supports_json_events: true,
    supports_exec_sandbox: true,
    supports_exec_approval_policy: true,
    supports_exec_cwd: true,
    supports_multi_agent_feature: true,
    multi_agent_feature_state: "enabled",
    multi_agent_v2_state: "disabled",
    subagent_config: {
      max_concurrent_threads_per_session: true,
      max_depth: true,
      default_subagent_model: true,
      default_subagent_reasoning_effort: true,
      job_max_runtime_seconds: true,
    },
    native_subagents: "available",
    warnings: [],
    ...overrides,
  };
}

function event(type: string, raw: Record<string, unknown>, text: string | null): EphemeralRunnerEvent {
  return { at: "2026-08-27T00:00:00.000Z", type, raw, text, subagent: null };
}

test("ephemeral CLI args force one-shot JSON execution and native subagent limits", () => {
  const args = buildEphemeralExecArgs(request, capabilities());
  assert.deepEqual(args.slice(0, 14), [
    "exec", "--ephemeral", "--json", "--model", "gpt-5.6-luna", "--sandbox", "read-only",
    "--cd", "C:\\Bridge", "--skip-git-repo-check", "-c", 'approval_policy="on-request"', "--enable", "multi_agent",
  ]);
  assert.ok(args.includes("--enable"));
  assert.ok(args.includes("multi_agent"));
  assert.ok(args.includes("agents.max_concurrent_threads_per_session=5"));
  assert.ok(args.includes("agents.max_depth=1"));
  assert.ok(args.includes('agents.default_subagent_model="gpt-5.6-luna"'));
  assert.ok(args.includes('agents.default_subagent_reasoning_effort="max"'));
  assert.equal(args.at(-1), request.prompt);
});

test("JSONL parser handles split chunks and records malformed lines without losing valid events", () => {
  const parser = new JsonlEventParser();
  assert.deepEqual(parser.push('{"type":"thread.started"}\n{"type":"item.completed","'), [{ type: "thread.started" }]);
  assert.deepEqual(parser.push('item":{"type":"agent_message","text":"FINAL"}}\nnot-json\n'), [{
    type: "item.completed",
    item: { type: "agent_message", text: "FINAL" },
  }]);
  assert.deepEqual(parser.finish(), []);
  assert.equal(parser.errors.length, 1);
});

test("final answer extraction prefers the completed agent message over deltas", () => {
  const events = [
    event("item/agentMessage/delta", { delta: "partial " }, "partial "),
    event("item/agentMessage/delta", { delta: "answer" }, "answer"),
    event("item.completed", { item: { type: "agent_message", text: "FINAL ANSWER" } }, "FINAL ANSWER"),
  ];
  assert.equal(extractFinalAnswer(events), "FINAL ANSWER");
  assert.equal(extractFinalAnswer(events.slice(0, 2)), "partial answer");
});

test("native subagent activity event shapes are recognized without a thread mapping", () => {
  const started = normalizeEphemeralEvent({ type: "sub_agent_activity", status: "started", agentThreadId: "agent-1" });
  const stopped = normalizeEphemeralEvent({ type: "collab_agent_spawn_end", status: "completed", new_thread_id: "agent-1" });
  assert.deepEqual(started.subagent, { kind: "started", id: "agent-1" });
  assert.deepEqual(stopped.subagent, { kind: "stopped", id: "agent-1" });
});

test("local capability probe confirms CLI 0.148.0 and config keys without editing config.toml", async () => {
  const calls: string[][] = [];
  const detected = await detectCodexCapabilities({
    executable: "codex",
    capabilityProbe: async (args) => {
      calls.push([...args]);
      if (args[0] === "--version") return { exit_code: 0, signal: null, stdout: "codex-cli 0.148.0\n", stderr: "" };
      if (args[0] === "exec") return { exit_code: 0, signal: null, stdout: "--ephemeral\n--json\n--sandbox\n--ask-for-approval\n--cd\n", stderr: "" };
      if (args[0] === "features") return { exit_code: 0, signal: null, stdout: "multi_agent stable true\nmulti_agent_v2 stable false\n", stderr: "" };
      return { exit_code: 0, signal: null, stdout: "help\n", stderr: "" };
    },
  });
  assert.equal(detected.version, "0.148.0");
  assert.equal(detected.supports_ephemeral_exec, true);
  assert.equal(detected.supports_json_events, true);
  assert.equal(detected.native_subagents, "available");
  assert.equal(detected.subagent_config.max_depth, true);
  assert.equal(calls.some((args) => args.includes("--strict-config")), true);
});
