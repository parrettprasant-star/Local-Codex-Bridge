// Actual Node stdio + lazy app-server adapter on macOS; FAKE executor, no cloud,
// account login, private sessions, user commands or user files are accessed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment, readJson, writePrivate } from "./macos-bridge.mjs";
if (process.platform !== "darwin") throw new Error("Actual macOS runner required");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fake = join(root, "test", "fake-codex-posix.mjs"); chmodSync(fake, 0o700);
const state = mkdtempSync(join(tmpdir(), "lcb-mac-native-"));
const isolatedHome = join(state, "home");
writePrivate(join(isolatedHome, "fixture.json"), {});
let child;
try {
  for (let round = 1; round <= 3; round++) {
    const generation = randomUUID();
    writePrivate(join(state, "launcher.lock"), { pid: process.pid, generation, updated_at: new Date().toISOString() });
    const env = childEnvironment(state, generation, process.pid, { codex_executable: fake }, { ...process.env, HOME: isolatedHome, CODEX_HOME: join(isolatedHome, ".codex") });
    child = spawn(process.execPath, [join(root, "scripts", "macos-bridge.mjs"), "mcp-child"], { env, stdio: ["pipe", "pipe", "pipe"] });
    const pending = new Map(); let counter = 0, buffered = "", errors = "";
    child.stderr.on("data", (b) => { errors = (errors + b).slice(-2000); });
    child.stdout.on("data", (b) => {
      buffered += b;
      while (buffered.includes("\n")) {
        const at = buffered.indexOf("\n"), line = buffered.slice(0, at); buffered = buffered.slice(at + 1);
        const message = JSON.parse(line);
        if (message.id && pending.has(message.id)) { const slot = pending.get(message.id); pending.delete(message.id); clearTimeout(slot.timer); message.error ? slot.reject(new Error(message.error.message)) : slot.resolve(message.result); }
      }
    });
    const request = (method, params) => new Promise((resolveRequest, reject) => {
      const id = ++counter;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("MCP timeout: " + method)); }, 5000);
      pending.set(id, { resolve: resolveRequest, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    const tool = async (name, args) => {
      const result = await request("tools/call", { name, arguments: args });
      assert.notEqual(result.isError, true);
      return result.structuredContent ?? JSON.parse(result.content.find((c) => c.type === "text").text);
    };
    const init = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mac-isolated-smoke", version: "1" } });
    assert.ok(init.serverInfo);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const catalog = await request("tools/list", {}); assert.equal(catalog.tools.length, 13);
    if (round === 1) {
      const lease = readJson(join(state, "status-url.json")); assert.equal(lease.state, "ready");
      const html = await (await fetch(lease.url.replace("/api/status", "/app"))).text();
      assert.ok(html.includes("page-overview"));
      const created = await tool("create_agent_task", { instruction: "FAKE TEST ONLY", cwd: state, title: "Mac adapter fixture" });
      assert.equal(created.accepted, true); assert.equal(created.cwd, realpathSync.native(state));
      await new Promise((r) => setTimeout(r, 80));
      const observed = await tool("codex_observe", { thread_id: created.thread_id, cursor: 0, limit: 20 });
      const confirmation = observed.pending_requests[0];
      if (confirmation) await tool("codex_respond", { request_id: confirmation.request_id, thread_id: confirmation.thread_id, turn_id: confirmation.turn_id, method: confirmation.method, decision: "decline" });
      await new Promise((r) => setTimeout(r, 100));
      const result = await tool("get_task_status", { task_id: created.task_id });
      assert.equal(result.status, "completed"); assert.equal(result.result_manifest.result_summary, "FAKE_FINAL");
      assert.ok(existsSync(join(state, "task_records.json")));
    }
    const beforeExit = readJson(join(state, "status-url.json"));
    child.stdin.end();
    const code = await new Promise((r, reject) => { const timer = setTimeout(() => reject(new Error("owned child did not exit")), 5000); child.once("close", (value) => { clearTimeout(timer); r(value); }); });
    assert.equal(code, 0, errors);
    assert.equal(readJson(join(state, "status-url.json")).state, "stopped");
    await assert.rejects(fetch(beforeExit.url, { signal: AbortSignal.timeout(1000) }));
  }
  console.log("MAC_NATIVE_ADAPTER=PASS MCP_CATALOG=13 RESTART_ROUNDS=3 PRIVATE_CODEX=UNTOUCHED FAKE_EXECUTOR=true");
} finally { if (child?.exitCode === null) child.kill("SIGTERM"); rmSync(state, { recursive: true, force: true }); }
