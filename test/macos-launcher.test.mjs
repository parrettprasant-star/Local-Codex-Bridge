import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { childEnvironment, profile, readiness, shellQuote, storeKey, writePrivate } from "../scripts/macos-bridge.mjs";

test("Mac profile quotes paths, keeps key out of config/argv and isolates Bridge state", () => {
  const state = join(tmpdir(), "lcb-mac-unit", "Application Support");
  const config = { tunnel_id: "tunnel_" + "1".repeat(32), codex_executable: "/Users/Demo/bin/codex" };
  const yaml = profile(config, state);
  assert.match(yaml, /env:CONTROL_PLANE_API_KEY/);
  assert.match(yaml, /127\.0\.0\.1:0/);
  assert.match(yaml, /mcp-child/);
  assert.equal(shellQuote("/Users/Demo/O'Brien folder"), "'/Users/Demo/O'\"'\"'Brien folder'");
  assert.throws(() => shellQuote("/Users/Demo\nrm"));
  const env = childEnvironment(state, "owner", 123, config, { HOME: "/Users/Demo", CONTROL_PLANE_API_KEY: "do-not-copy", OPENAI_API_KEY: "do-not-copy", HTTPS_PROXY: "http://127.0.0.1:1234" });
  assert.equal(env.HOME, "/Users/Demo"); assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:1234");
  assert.equal(env.CONTROL_PLANE_API_KEY, undefined);
  // Preserve native Codex's explicit auth environment, without persisting it.
  assert.equal(env.OPENAI_API_KEY, "do-not-copy");
  assert.equal(env.LOCAL_CODEX_BRIDGE_STATUS_PORT, "0");
  assert.ok(env.LOCAL_CODEX_BRIDGE_TASKS_FILE.startsWith(state));
  assert.equal(env.LOCAL_CODEX_BRIDGE_CHECKPOINT_DIR, join(state, "checkpoints"));
  assert.equal(env.LOCAL_CODEX_BRIDGE_SERVICE_SESSIONS_FILE, join(state, "service_sessions.json"));
});

test("macOS security interpreter stores and reads a dummy key in an isolated keychain", { skip: process.platform !== "darwin" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "lcb-keychain-test-"));
  const keychainFile = join(directory, "fixture.keychain-db");
  const password = randomUUID();
  const security = (args) => { const result = spawnSync("/usr/bin/security", args, { encoding: "utf8" }); assert.equal(result.status, 0); };
  try {
    security(["create-keychain", "-p", password, keychainFile]);
    security(["unlock-keychain", "-p", password, keychainFile]);
    storeKey("fixture-" + "x".repeat(24), { keychainFile });
    assert.throws(() => storeKey("line\ninjection", { keychainFile }));
  } finally {
    spawnSync("/usr/bin/security", ["delete-keychain", keychainFile]);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Mac readiness never trusts stale ready JSON or another generation/parent", async () => {
  const state = mkdtempSync(join(tmpdir(), "lcb-mac-health-"));
  const server = createServer((_req, res) => { res.writeHead(200); res.end("ready"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    writePrivate(join(state, "tunnel-state.json"), { status: "running", registration: "ready" });
    writeFileSync(join(state, "health-url.txt"), "http://127.0.0.1:" + port);
    assert.equal((await readiness(state, "new", process.pid)).ready, false);
    writePrivate(join(state, "child-identity.json"), { generation: "old", pid: process.pid, parent_pid: process.pid });
    assert.equal((await readiness(state, "new", process.pid)).ready, false);
    writePrivate(join(state, "child-identity.json"), { generation: "new", pid: process.pid, parent_pid: process.pid });
    assert.equal((await readiness(state, "new", process.pid)).ready, true);
    assert.equal((await readiness(state, "new", 2147483000)).ready, false);
    writeFileSync(join(state, "health-url.txt"), "https://example.com");
    assert.equal((await readiness(state, "new", process.pid)).ready, false);
    if (process.platform !== "win32") assert.equal(statSync(join(state, "child-identity.json")).mode & 0o777, 0o600);
    assert.doesNotMatch(readFileSync(join(state, "child-identity.json"), "utf8"), /api_key/);
  } finally { await new Promise((r) => server.close(r)); rmSync(state, { recursive: true, force: true }); }
});
