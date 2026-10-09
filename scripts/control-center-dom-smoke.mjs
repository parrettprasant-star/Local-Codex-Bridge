import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const shellPath = resolve(process.env.DOM_SMOKE_SHELL ?? join(repoRoot, ".staging", "dist", "src", "control-center-shell.js"));
const edgePath = process.env.EDGE_EXE
  ?? (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
const { APP_SHELL_HTML } = await import(pathToFileURL(shellPath).href);

function writeJson(response, value) {
  const body = JSON.stringify(value);
  response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/app") {
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(APP_SHELL_HTML) });
    response.end(APP_SHELL_HTML);
    return;
  }
  if (url.pathname === "/api/status") {
    writeJson(response, {
      bridge: { status: "running", product_name: "Local Codex Bridge" },
      appServer: { process_state: "running" },
      tunnel: { status: "running", registration: "ready", client_version: "smoke" },
      plugin_bridge: { status: "ready", transport: "tunnel" },
      native_session_transport: { status: "ready" },
      control_center: {
        source: "normalized_status",
        bridge: { state: "connected", label: "已连接" },
        tunnel: { state: "ready", label: "已就绪", registration: "ready" },
        plugin: { state: "ready", label: "已就绪" },
        codex: { state: "ready", label: "已就绪" },
        activeNativeTurns: [],
        agentJobs: { running: 0, queued: 0, max: 5, recentFailures: 0 },
        queue: { depth: 0, pending: 0 },
      },
      workers: { running: 0, bridge_running: 0, native_active: 0, max: 5 },
      queue: { depth: 0 },
      tasks: { active: [], waiting: [], recent_completed: [], pending_confirmations: [], items: [], counts: {} },
      dashboard: { pending_confirmation_count: 0 },
    });
    return;
  }
  if (url.pathname === "/api/service-sessions") {
    writeJson(response, { agents: { active_jobs: 0, queued_jobs: 0, max_jobs: 5 } });
    return;
  }
  if (url.pathname === "/api/native-threads") {
    writeJson(response, { source: "codex_app_server", data: [], nextCursor: null });
    return;
  }
  if (url.pathname === "/api/diagnostics") {
    writeJson(response, { status: { bridge: { status: "running" }, tunnel: { status: "running", registration: "ready" }, plugin_bridge: { status: "ready" }, native_session_transport: { status: "ready" }, control_center: { bridge: { state: "connected", label: "已连接" }, tunnel: { state: "ready", label: "已就绪", registration: "ready" }, plugin: { state: "ready", label: "已就绪" }, codex: { state: "ready", label: "已就绪" }, agentJobs: { running: 0, queued: 0, max: 5, recentFailures: 0 }, queue: { depth: 0, pending: 0 } } } });
    return;
  }
  if (url.pathname === "/api/events") {
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/event-stream; charset=utf-8", "Connection": "close" });
    response.end("event: ready\ndata: {}\n\n");
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
if (!address || typeof address === "string") throw new Error("DOM smoke server did not expose a port");
const profile = mkdtempSync(join(repoRoot, ".staging", "control-center-dom-smoke-"));
const child = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--virtual-time-budget=1800",
  "--user-data-dir=" + profile,
  "--dump-dom",
  "http://127.0.0.1:" + address.port + "/app",
], { cwd: repoRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
let errorOutput = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { errorOutput = (errorOutput + chunk).slice(-4_000); });
const exitCode = await new Promise((resolvePromise) => {
  const timeout = setTimeout(() => {
    if (child.pid) spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    resolvePromise(null);
  }, 8_000);
  child.once("close", (code) => { clearTimeout(timeout); resolvePromise(code); });
});
await new Promise((resolvePromise) => server.close(() => resolvePromise()));
try { rmSync(profile, { recursive: true, force: true }); } catch { }

const ready = output.includes('data-control-center-ready="true"')
  && output.includes('id="page-overview"')
  && output.includes(">总览<")
  && output.includes('class="client-fallback hidden"');
if (!ready) {
  process.stderr.write(JSON.stringify({ exitCode, outputTail: output.slice(-2_000), stderr: errorOutput }, null, 2) + "\n");
  process.exitCode = 1;
}
process.stdout.write("CONTROL_CENTER_DOM_READY=" + (ready ? "PASS" : "FAIL") + "\n");
