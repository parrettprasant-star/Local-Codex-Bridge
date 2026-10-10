// macOS browser-host preview. No Windows host, native Codex configuration or
// session data is changed. Only the exact Tunnel ChildProcess belongs to us.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
export const keychainService = "org.localcodexbridge.macos.control-plane";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export function alive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
export function readJson(file) { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } }
export function writePrivate(file, data) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID() + ".tmp";
  writeFileSync(temp, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temp, file);
}
export function shellQuote(value) {
  if (/[\0\r\n]/.test(value)) throw new Error("路径不能包含控制字符");
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}
export function validateConfig(value) {
  if (!value || value.schema_version !== 1 || !/^tunnel_[0-9a-f]{32}$/.test(value.tunnel_id)) throw new Error("需要受支持的个人 Tunnel ID；请先运行 setup");
  for (const name of ["tunnel_executable", "codex_executable"]) {
    const file = value[name];
    if (typeof file !== "string" || !isAbsolute(file) || /[\0\r\n]/.test(file)) throw new Error(name + " 必须是本机绝对路径");
    accessSync(file, constants.X_OK);
  }
  return value;
}
export function childEnvironment(state, generation, ownerPid, config, source = process.env) {
  // Preserve the user's actual Codex auth/home and proxy environment. Isolated
  // CI sets its own HOME/CODEX_HOME. Never copy or rewrite auth.json/config.toml.
  const env = { ...source };
  delete env.CONTROL_PLANE_API_KEY;
  Object.assign(env, {
    CODEX_EXE: config.codex_executable, LCB_MAC_STATE_DIR: state,
    LCB_MAC_GENERATION: generation, LCB_MAC_OWNER_PID: String(ownerPid),
    LOCAL_CODEX_BRIDGE_TASKS_FILE: join(state, "task_records.json"),
    LOCAL_CODEX_BRIDGE_STATUS_FILE: join(state, "task_status.json"),
    LOCAL_CODEX_BRIDGE_STATUS_URL_FILE: join(state, "status-url.json"),
    LOCAL_CODEX_BRIDGE_PROJECTS_FILE: join(state, "projects.json"),
    LOCAL_CODEX_BRIDGE_CHECKPOINT_DIR: join(state, "checkpoints"),
    LOCAL_CODEX_BRIDGE_SERVICE_SESSIONS_FILE: join(state, "service_sessions.json"),
    LOCAL_CODEX_BRIDGE_TUNNEL_STATE_FILE: join(state, "tunnel-state.json"),
    LOCAL_CODEX_BRIDGE_STATUS_PORT: "0",
  });
  return env;
}
export function profile(config, state) {
  const command = [process.execPath, script, "mcp-child"].map(shellQuote).join(" ");
  return `config_version: 1
control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: ${JSON.stringify(config.tunnel_id)}
  api_key: "env:CONTROL_PLANE_API_KEY"
health:
  listen_addr: "127.0.0.1:0"
  url_file: ${JSON.stringify(join(state, "health-url.txt"))}
admin_ui:
  open_browser: false
log:
  level: info
  format: json
mcp:
  commands:
    - channel: main
      command: ${JSON.stringify(command)}
`;
}
export async function readiness(state, generation, tunnelPid) {
  const child = readJson(join(state, "child-identity.json"));
  let healthUrl = "";
  try { healthUrl = readFileSync(join(state, "health-url.txt"), "utf8").trim(); } catch { /* not published */ }
  const identity = child?.generation === generation && child.parent_pid === tunnelPid && alive(child.pid) && alive(tunnelPid);
  const validUrl = /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(healthUrl);
  let health = false;
  if (identity && validUrl) {
    try { const response = await fetch(healthUrl + "/readyz", { signal: AbortSignal.timeout(1500), redirect: "error" }); health = response.ok; await response.body?.cancel(); } catch { /* fail closed */ }
  }
  return { ready: Boolean(identity && health), child_pid: identity ? child.pid : null, health_url: validUrl ? healthUrl : null };
}
export function storeKey(secret, { keychainFile } = {}) {
  // Feed security's interactive interpreter on stdin, NOT a secret in argv.
  // Only bounded single-token API keys are accepted, so no interpreter commands
  // or newlines can be injected. Never return security's raw output in errors.
  if (!/^[A-Za-z0-9_.-]{16,512}$/.test(secret)) throw new Error("API key 格式无效；密钥未保存");
  if (keychainFile && (!isAbsolute(keychainFile) || /[\0\r\n"\\]/.test(keychainFile))) throw new Error("无效的隔离测试钥匙串路径");
  const keychain = keychainFile ? ` "${keychainFile}"` : "";
  const input = `add-generic-password -U -a "control-plane" -s "${keychainService}" -w "${secret}"${keychain}\n`;
  const result = spawnSync("/usr/bin/security", ["-i"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 });
  if (result.status !== 0) throw new Error("钥匙串保存失败；未把密钥写入配置或日志");
  const verified = spawnSync("/usr/bin/security", ["find-generic-password", "-a", "control-plane", "-s", keychainService, "-w", ...(keychainFile ? [keychainFile] : [])], { encoding: "utf8", timeout: 30000 });
  if (verified.status !== 0 || verified.stdout.trim() !== secret) throw new Error("钥匙串保存读回验证失败；未采用明文替代");
}
export function loadKey() {
  const envKey = process.env.CONTROL_PLANE_API_KEY;
  if (envKey) return envKey;
  const result = spawnSync("/usr/bin/security", ["find-generic-password", "-a", "control-plane", "-s", keychainService, "-w"], { encoding: "utf8", timeout: 30000 });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error("无法读取自己的 Tunnel 密钥；运行 setup 或由本机安全环境提供 CONTROL_PLANE_API_KEY。不要把密钥发给 ChatGPT");
  return result.stdout.trim();
}
async function hiddenSecret() {
  if (!process.stdin.isTTY) throw new Error("setup 需要交互式本机终端；不要把密钥放进命令参数或 ChatGPT");
  process.stdout.write("个人 Tunnel 控制面 API key（隐藏输入，仅存 macOS 钥匙串）：");
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolveSecret, reject) => {
    let value = "";
    const finish = (error) => { process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); error ? reject(error) : resolveSecret(value); };
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") return finish(new Error("配置已取消"));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (/^[A-Za-z0-9_.-]$/.test(char) && value.length < 512) value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}
async function setup(state) {
  const configFile = join(state, "config.json");
  const old = readJson(configFile);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let config, project = null;
  try {
    if (old && (await rl.question("已有配置。备份后重新配置？输入 yes：")).trim() !== "yes") return;
    const tunnel_id = (await rl.question("自己的 Tunnel ID（不是 MCP URL）：")).trim();
    const suggested = join(root, "tunnel-client");
    const tunnel_executable = realpathSync((await rl.question(`Tunnel client 绝对路径（默认 ${suggested}）：`)).trim() || suggested);
    const found = spawnSync("/usr/bin/which", ["codex"], { encoding: "utf8" }).stdout.trim();
    const codex_executable = realpathSync((await rl.question(`Codex CLI 绝对路径（默认 ${found || "未检测到"}）：`)).trim() || found);
    config = validateConfig({ schema_version: 1, tunnel_id, tunnel_executable, codex_executable });
    const projectPath = (await rl.question("可选：注册一个项目的绝对目录（留空跳过，不创建目录）：")).trim();
    if (projectPath) {
      const physical = realpathSync(projectPath);
      const check = spawnSync("/usr/bin/test", ["-d", physical]);
      if (check.status !== 0) throw new Error("项目目录不存在");
      project = { project_id: "my-project", project_name: "我的项目", root_path: physical, allowed_capabilities: ["file_read"] };
    }
  } finally { rl.close(); }
  const secret = await hiddenSecret(); storeKey(secret);
  if (old) writePrivate(join(state, "config-backup-" + Date.now() + ".json"), old);
  writePrivate(configFile, config);
  if (project) {
    const projectsFile = join(state, "projects.json");
    const existing = readJson(projectsFile);
    if (existsSync(projectsFile)) writePrivate(join(state, "projects-backup-" + Date.now() + ".json"), readFileSync(projectsFile, "utf8"));
    const projects = Array.isArray(existing?.projects) ? existing.projects.filter((p) => p.project_id !== project.project_id) : [];
    writePrivate(projectsFile, { schema_version: 1, projects: [...projects, project] });
  }
  console.log("配置已保存。密钥不在 JSON/YAML 中。运行 node scripts/macos-bridge.mjs start。");
}
async function mcpChild(state) {
  delete process.env.CONTROL_PLANE_API_KEY;
  const generation = process.env.LCB_MAC_GENERATION;
  const owner = Number(process.env.LCB_MAC_OWNER_PID);
  if (!generation || !Number.isInteger(owner) || !alive(owner)) throw new Error("MCP child 缺少有效 launcher ownership");
  const identity = { generation, pid: process.pid, parent_pid: process.ppid, launcher_pid: owner, started_at: new Date().toISOString() };
  writePrivate(join(state, "child-identity.json"), identity);
  process.chdir(root); // build identity and optional static files use package cwd
  const timer = setInterval(() => {
    const lock = readJson(join(state, "launcher.lock"));
    const stop = readJson(join(state, "stop.json"));
    const stamp = Date.parse(lock?.updated_at ?? "");
    if (!alive(owner) || lock?.generation !== generation || stop?.generation === generation || !Number.isFinite(stamp) || Date.now() - stamp > 15000) process.kill(process.pid, "SIGTERM");
  }, 3000);
  timer.unref();
  await import(pathToFileURL(join(root, "dist", "src", "index.js")).href);
}
export async function supervise(state, config, key, { openBrowser = true, signal } = {}) {
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const lockFile = join(state, "launcher.lock");
  const prior = readJson(lockFile);
  if (existsSync(lockFile)) {
    if (!prior || alive(prior.pid)) throw new Error("已有或无法确认的 launcher ownership；不结束未知进程");
    renameSync(lockFile, join(state, "stale-lock-" + Date.now() + ".json"));
  }
  let generation = randomUUID();
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, generation, updated_at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  let child = null, stopping = Boolean(signal?.aborted), opened = false, attempt = 0, spawnFailed = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop); signal?.addEventListener("abort", stop);
  const publish = (status, evidence, reason = null) => writePrivate(join(state, "tunnel-state.json"), {
    status, registration: evidence.ready ? "ready" : status === "starting" ? "registering" : "failed",
    tunnel_id: config.tunnel_id, parent_pid: child?.pid ?? null, mcp_child_pid: evidence.child_pid ?? null,
    health_url: evidence.health_url ?? null, health_probe: evidence.ready ? "ok" : "failed",
    transport_status: evidence.ready ? "ready" : status === "starting" ? "unknown" : "closed",
    last_error: reason, last_disconnect_reason: reason, restart_attempt: attempt,
    updated_at: new Date().toISOString(),
  });
  const endChild = async () => {
    if (!child || spawnFailed) return;
    writePrivate(join(state, "stop.json"), { generation });
    // Allow the Bridge child to close its own app-server before Tunnel shutdown.
    const marker = readJson(join(state, "child-identity.json"));
    for (let i = 0; i < 20 && marker?.generation === generation && alive(marker.pid); i++) await wait(250);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await wait(250);
    if (child.exitCode === null && child.signalCode === null) throw new Error("owned Tunnel 尚未退出；未按名称结束任何进程");
  };
  try {
    while (!stopping && attempt <= 3) {
      opened = false; // A recovered child publishes a fresh dynamic UI port.
      generation = randomUUID();
      writePrivate(lockFile, { pid: process.pid, generation, updated_at: new Date().toISOString() });
      writePrivate(join(state, "profile.yaml"), profile(config, state));
      for (const file of ["health-url.txt", "child-identity.json", "status-url.json"]) { try { unlinkSync(join(state, file)); } catch (e) { if (e.code !== "ENOENT") throw e; } }
      spawnFailed = false;
      child = spawn(config.tunnel_executable, ["run", "--config", join(state, "profile.yaml"), "--health.url-file", join(state, "health-url.txt")], {
        env: { ...childEnvironment(state, generation, process.pid, config), CONTROL_PLANE_API_KEY: key },
        stdio: ["ignore", "pipe", "pipe"], shell: false,
      });
      child.on("error", () => { spawnFailed = true; });
      // Discard raw Tunnel payloads: they may contain request/private data. Only
      // bounded derived status/reasons are persisted or displayed.
      child.stdout.resume(); child.stderr.resume();
      const start = Date.now(); let wasReady = false, failures = 0;
      publish("starting", {});
      while (!stopping && !spawnFailed && child.exitCode === null && child.signalCode === null) {
        writePrivate(lockFile, { pid: process.pid, generation, updated_at: new Date().toISOString() });
        const evidence = await readiness(state, generation, child.pid);
        publish(evidence.ready ? "running" : wasReady ? "error" : "starting", evidence, evidence.ready ? null : wasReady ? "transport_not_ready" : null);
        wasReady ||= evidence.ready; failures = evidence.ready ? 0 : failures + 1;
        const marker = readJson(join(state, "child-identity.json"));
        const lease = readJson(join(state, "status-url.json"));
        if (!opened && openBrowser && marker?.generation === generation && marker.parent_pid === child.pid && lease?.state === "ready" && /^http:\/\/127\.0\.0\.1:\d+\/api\/status$/.test(lease.url)) {
          const opener = spawn("/usr/bin/open", [lease.url.replace("/api/status", "/app")], { stdio: "ignore", shell: false });
          opener.on("error", () => {}); opened = true;
        }
        if ((wasReady && failures >= 3) || Date.now() - start > 60000 && !wasReady) break;
        await wait(2000);
      }
      publish("error", {}, stopping ? "user_shutdown" : "owned_transport_exited");
      await endChild();
      if (stopping) break;
      attempt++;
      if (attempt <= 3) await wait(1000 * 2 ** attempt);
    }
    if (!stopping) throw new Error("Tunnel 恢复 3 次仍失败；请查看自己的账号权限和网络，不会无限重启");
  } finally {
    let clean = false;
    try { await endChild(); clean = true; } finally {
      publish(clean ? "stopped" : "error", {}, clean ? "launcher_stopped" : "owned_cleanup_incomplete");
      if (clean && readJson(lockFile)?.pid === process.pid) unlinkSync(lockFile);
      process.off("SIGINT", stop); process.off("SIGTERM", stop); signal?.removeEventListener("abort", stop);
    }
  }
}
async function main() {
  if (process.platform !== "darwin") throw new Error("此启动器用于 macOS；Windows 请使用正式 Windows 安装包");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Bridge 需要 Node.js 24 或更新版本");
  const state = resolve(process.env.LCB_MAC_STATE_DIR || join(homedir(), "Library", "Application Support", "LocalCodexBridge"));
  const action = process.argv[2] || "doctor";
  if (action === "mcp-child") return mcpChild(state);
  if (action === "setup") return setup(state);
  if (action === "doctor") {
    if (!existsSync(join(root, "dist", "src", "index.js"))) throw new Error("缺少 dist，请先 npm ci && npm run build");
    validateConfig(readJson(join(state, "config.json")));
    console.log("本机依赖/配置可读。doctor 未登录、未创建会话，也未证明 ChatGPT Cloud 已连接。"); return;
  }
  if (action !== "start") throw new Error("用法：node scripts/macos-bridge.mjs setup | doctor | start");
  const config = validateConfig(readJson(join(state, "config.json")));
  if (!existsSync(join(root, "dist", "src", "index.js"))) throw new Error("缺少 dist，请先构建或下载完整 Mac 包");
  console.log("正在启动个人 Tunnel。浏览器 Control Center 关闭不会退出 Bridge；本终端 Ctrl+C 真退出。");
  await supervise(state, config, loadKey());
}
if (process.argv[1] && resolve(process.argv[1]) === script) main().catch(() => {
  // Do not leak the raw exception (paths/request bodies/keychain errors).
  process.stderr.write("Mac Bridge 未完成启动或已停止。运行 doctor 检查依赖和配置；请勿把密钥/完整日志发到公开 Issue。\n"); process.exitCode = 1;
});
