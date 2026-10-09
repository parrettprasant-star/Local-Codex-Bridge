import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { APP_SHELL_HTML } from "../src/control-center-shell.js";
import { STATUS_PAGE_HTML } from "../src/status-page.js";
import { readBuildIdentity } from "../src/build-identity.js";
import { TaskManager } from "../src/task-manager.js";
import { TaskRuntime } from "../src/task-runtime.js";
import { TaskStatusStore } from "../src/task-status.js";
import { TaskStatusServer } from "./browser-safe-status-server.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bridge-local-http-"));
  const store = new TaskStatusStore(join(directory, "status.json"));
  const manager = new TaskManager(join(directory, "tasks.json"), store);
  const runtime = new TaskRuntime(manager);
  return { directory, manager, store, runtime, server: new TaskStatusServer(store, manager, runtime, { port: 0 }) };
}

test("build identity follows the actual package, never a hard-coded old FINAL label", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridge-build-identity-"));
  try {
    assert.deepEqual(readBuildIdentity(directory), { label: "Local Codex Bridge development", version: "unversioned" });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "6.0.0", build_label: "ci-review" }));
    assert.deepEqual(readBuildIdentity(directory), { version: "6.0.0", label: "ci-review" });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: {}, build_label: { private: "ignored" } }));
    assert.equal(readBuildIdentity(directory).label.includes("[object Object]"), false);
    writeFileSync(join(directory, "package.json"), "invalid json");
    assert.equal(readBuildIdentity(directory).version, "unversioned");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

async function bootstrap(base: string) {
  const response = await fetch(base + "/api/local-session", { headers: { "X-Bridge-Local-Client": "1" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return (await response.json() as { request_token: string }).request_token;
}

// node:fetch deliberately rewrites Host. Use a raw HTTP client when testing
// rebinding/ambiguous headers so the exact claimed host reaches the server.
async function rawPost(url: string, headers: Record<string, string>, body: string) {
  return await new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request(url, { method: "POST", headers }, response => {
      let result = "";
      response.setEncoding("utf8"); response.on("data", chunk => { result += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: result }));
      response.on("error", reject);
    });
    req.on("error", reject); req.end(body);
  });
}

test("local HTTP rejects cross-origin, rebinding, forged and non-JSON writes before any mutation", async () => {
  const f = fixture();
  try {
    const address = await f.server.start();
    const base = `http://127.0.0.1:${address.port}`;
    const token = await bootstrap(base);
    const original = JSON.stringify(f.manager.snapshot());
    const body = JSON.stringify({ text: "must never dispatch", cwd: f.directory });
    const cases: Array<{ label: string; headers: Record<string, string>; expected: number }> = [
      { label: "missing token", headers: { "Content-Type": "application/json", "X-Bridge-Request-Token": "" }, expected: 403 },
      { label: "wrong token", headers: { "Content-Type": "application/json", "X-Bridge-Request-Token": "0".repeat(64) }, expected: 403 },
      { label: "foreign host", headers: { Host: `evil.example:${address.port}` }, expected: 403 },
      { label: "foreign origin", headers: { Origin: "https://evil.example" }, expected: 403 },
      { label: "null origin", headers: { Origin: "null" }, expected: 403 },
      { label: "same site is not same origin", headers: { "Sec-Fetch-Site": "same-site" }, expected: 403 },
      { label: "cross site", headers: { "Sec-Fetch-Site": "cross-site" }, expected: 403 },
      { label: "plain JSON form", headers: { "Content-Type": "text/plain" }, expected: 415 },
      { label: "form body", headers: { "Content-Type": "application/x-www-form-urlencoded" }, expected: 415 },
    ];
    for (const item of cases) {
      const response = await rawPost(base + "/api/service-codex/tasks", {
        "Content-Type": "application/json", "X-Bridge-Request-Token": token, ...item.headers,
      }, body);
      assert.equal(response.status, item.expected, item.label);
      assert.equal(response.headers["access-control-allow-origin"], undefined);
      assert.equal(response.body.includes(token), false, "Do not echo authorization secrets");
    }
    for (const path of ["/api/native-threads", "/api/tasks", "/api/task-status", "/api/service-codex/tasks/id/cancel", "/api/tasks/id/review", "/api/tasks/id/open-output-directory"]) {
      const response = await fetch(base + path, { method: "POST" });
      assert.equal(response.status, 403, path);
    }
    assert.equal(JSON.stringify(f.manager.snapshot()), original, "Denied controls must not create/update tasks");
    for (const path of ["/api/local-session", "/app", "/api/status"]) {
      const response = await fetch(base + path, { headers: { Origin: "https://evil.example", "X-Bridge-Local-Client": "1" } });
      assert.equal(response.status, 403);
    }
    assert.equal((await fetch(base + "/api/local-session")).status, 403);
    assert.equal((await fetch(base + "/api/local-session", { method: "OPTIONS", headers: { "Access-Control-Request-Headers": "x-bridge-local-client" } })).status, 403);
    const duplicate = await new Promise<number>((resolve, reject) => {
      const req = request(base + "/api/status", { headers: ["Host", `127.0.0.1:${address.port}`, "Host", `127.0.0.1:${address.port}`] }, response => {
        response.resume(); resolve(response.statusCode ?? 0);
      });
      req.on("error", reject); req.end();
    });
    assert.equal(duplicate, 403);
  } finally { await f.server.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test("authorized WebView and explicit local clients retain read, write and bodyless control behavior", async () => {
  const f = fixture();
  try {
    const address = await f.server.start();
    const base = `http://127.0.0.1:${address.port}`;
    const token = await bootstrap(base);
    for (const path of ["/app", "/status"]) {
      const page = await fetch(base + path, { headers: { "Sec-Fetch-Site": "same-origin", Origin: base } });
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("x-frame-options"), "DENY");
      assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
      assert.ok((await page.text()).includes(`<meta name="bridge-request-token" content="${token}">`));
    }
    assert.equal((await fetch(base + "/api/status")).status, 200, "Desktop read-only health remains compatible");
    const write = await fetch(base + "/api/task-status", {
      method: "PUT", headers: { Origin: base, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json; charset=utf-8", "X-Bridge-Request-Token": token },
      body: JSON.stringify({ task_name: "isolated authorization test", phase: "reading", progress_percent: 20 }),
    });
    assert.equal(write.status, 200);
    assert.equal((await write.json() as { name: string }).name, "isolated authorization test");
    const control = await fetch(base + "/api/service-codex/tasks/unknown/cancel", { method: "POST", headers: { "X-Bridge-Request-Token": token } });
    assert.equal(control.status, 503, "Authorized bodyless request reaches the normal service-availability guard");
    assert.ok(APP_SHELL_HTML.includes('headers.set("X-Bridge-Request-Token", authorization.content)'));
    assert.ok(STATUS_PAGE_HTML.includes('"X-Bridge-Request-Token": authorization.content'));
  } finally { await f.server.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test("restart rotates local HTTP authorization; stale pages cannot replay mutations", async () => {
  const f = fixture();
  let second: TaskStatusServer | undefined;
  try {
    const first = await f.server.start();
    const oldToken = await bootstrap(`http://127.0.0.1:${first.port}`);
    await f.server.close();
    second = new TaskStatusServer(f.store, f.manager, f.runtime, { port: 0 });
    const restarted = await second.start();
    const base = `http://127.0.0.1:${restarted.port}`;
    assert.notEqual(await bootstrap(base), oldToken);
    const response = await fetch(base + "/api/task-status", {
      method: "PUT", headers: { "X-Bridge-Request-Token": oldToken, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 403);
  } finally { await f.server.close(); await second?.close(); rmSync(f.directory, { recursive: true, force: true }); }
});
