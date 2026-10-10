// Actual renderer evaluation with a private profile, never the user's browser.
// Mac hosted Chrome can emit dump-dom but hang during CLI shutdown; CDP gives
// explicit DOM evidence and explicit, exact-owned Browser.close cleanup.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function probeHeadlessPage(executable, profile, url, expression) {
  const expectedUrl = new URL(url).href;
  const child = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--window-size=1400,900", expectedUrl], { stdio: "ignore" });
  let socket, spawnError, nextId = 0;
  child.on("error", (error) => { spawnError = error; });
  const pending = new Map();
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    const deadline = Date.now() + 20000;
    let target;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error("Owned browser exited before DOM evaluation");
      try {
        const port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
        if (/^\d{1,5}$/.test(port)) {
          const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
          target = pages.find((page) => page.type === "page" && page.url === expectedUrl);
          if (target) break;
        }
      } catch { /* browser still starting */ }
      await wait(100);
    }
    if (!target || !/^ws:\/\/127\.0\.0\.1:\d+\//.test(target.webSocketDebuggerUrl)) throw new Error("Owned browser debugging target unavailable");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Owned CDP handshake timeout")), 5000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Owned CDP handshake failed")); }, { once: true });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Owned CDP transport closed")); }
      pending.clear();
    });
    let last;
    while (Date.now() < deadline) {
      const result = await request("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error("Real renderer exception: " + result.exceptionDetails.text);
      last = result.result?.value;
      if (last?.ready) return last;
      await wait(150);
    }
    throw new Error("Real DOM not ready: " + JSON.stringify(last));
  } finally {
    if (socket?.readyState === WebSocket.OPEN) await request("Browser.close").catch(() => {});
    socket?.close();
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null && !spawnError; i++) await wait(100);
    if (child.exitCode === null && child.signalCode === null && !spawnError) child.kill("SIGTERM");
    for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null && !spawnError; i++) await wait(100);
    if (child.exitCode === null && child.signalCode === null && !spawnError) throw new Error("Exact-owned browser cleanup failed");
  }
}
