import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { APP_SHELL_HTML } from "../.staging/dist/src/control-center-shell.js";
import { probeHeadlessPage } from "./headless-page-probe.mjs";

const edgePath = process.env.EDGE_EXE
  ?? (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
const style = APP_SHELL_HTML.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div class="native-layout" style="height:600px;margin:0">
  <aside class="surface detail-panel" id="detailPanel">
    <div class="surface-header"><div class="surface-title">会话详情</div></div>
    <div class="surface-body native-detail-scroll" id="detailBody">${Array.from({ length: 80 }, (_, index) => `<div class="turn-item"><div class="turn-role">Turn ${index + 1}</div><div class="turn-content">${"长文本内容。".repeat(40)}</div></div>`).join("")}</div>
  </aside>
</div>
<script>
  try {
    const body = document.getElementById("detailBody");
    const computed = getComputedStyle(body);
    document.documentElement.setAttribute("data-native-detail-scroll-pass", String(body.scrollHeight > body.clientHeight && (computed.overflowY === "auto" || computed.overflowY === "scroll")));
    document.documentElement.setAttribute("data-native-detail-scroll-height", String(body.scrollHeight));
    document.documentElement.setAttribute("data-native-detail-client-height", String(body.clientHeight));
    document.documentElement.setAttribute("data-native-detail-overflow-y", computed.overflowY);
    document.documentElement.setAttribute("data-native-detail-inner-width", String(window.innerWidth));
    const header = document.querySelector(".surface-header");
    const headerTop = header.getBoundingClientRect().top;
    body.scrollTop = body.scrollHeight;
    document.documentElement.setAttribute("data-native-detail-bottom", String(body.scrollTop + body.clientHeight >= body.scrollHeight - 1));
    document.documentElement.setAttribute("data-native-detail-fixed-header", String(header.getBoundingClientRect().top === headerTop));
    document.documentElement.setAttribute("data-native-detail-no-horizontal-overflow", String(body.scrollWidth <= body.clientWidth));
    // The geometry is measured with all 80 full turns. Emit only the measured
    // evidence, not hundreds of kilobytes of fixture text to Chrome dump-dom.
    document.body.textContent = "Native detail geometry measured";
  } catch (error) {
    document.documentElement.setAttribute("data-native-detail-scroll-error", String(error));
  }
</script></body></html>`;

const server = http.createServer((request, response) => {
  if (request.url === "/native-detail-scroll") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(fixture) });
    response.end(fixture);
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("DOM smoke server did not expose a port");
const profile = mkdtempSync(join(process.cwd(), ".staging", "native-detail-scroll-dom-smoke-"));
if (process.platform === "darwin") {
  let passed = false;
  try {
    const evidence = await probeHeadlessPage(edgePath, profile, `http://127.0.0.1:${address.port}/native-detail-scroll`, `(() => {
      const d = document.documentElement.dataset;
      return { ready: d.nativeDetailScrollPass === "true", width: Number(d.nativeDetailInnerWidth), overflowY: d.nativeDetailOverflowY,
        scrollHeight: Number(d.nativeDetailScrollHeight), clientHeight: Number(d.nativeDetailClientHeight), bottom: d.nativeDetailBottom === "true",
        fixedHeader: d.nativeDetailFixedHeader === "true", noHorizontalOverflow: d.nativeDetailNoHorizontalOverflow === "true" };
    })()`);
    passed = evidence.width > 980 && evidence.scrollHeight > evidence.clientHeight && ["auto", "scroll"].includes(evidence.overflowY)
      && evidence.bottom && evidence.fixedHeader && evidence.noHorizontalOverflow;
    console.log("NATIVE_DETAIL_SCROLL_EVIDENCE=" + JSON.stringify(evidence));
  } catch (error) { console.error(error.message); }
  finally { await new Promise((r) => server.close(r)); rmSync(profile, { recursive: true, force: true }); }
  console.log("NATIVE_DETAIL_SCROLL_DOM=" + (passed ? "PASS" : "FAIL"));
  process.exit(passed ? 0 : 1);
}
const child = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--user-data-dir=" + profile,
  "--window-size=1400,900",
  "--virtual-time-budget=1200",
  "--dump-dom",
  `http://127.0.0.1:${address.port}/native-detail-scroll`,
], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
let errorOutput = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { errorOutput = (errorOutput + chunk).slice(-4_000); });
const exitCode = await new Promise((resolve) => {
  const timeout = setTimeout(() => {
    if (child.pid && process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
    resolve(null);
  }, 20_000);
  child.once("close", (code) => { clearTimeout(timeout); resolve(code); });
});
await new Promise((resolve) => server.close(() => resolve()));
try { rmSync(profile, { recursive: true, force: true }); } catch { }
const pass = exitCode === 0 && output.includes('data-native-detail-scroll-pass="true"')
  && output.includes('data-native-detail-bottom="true"')
  && output.includes('data-native-detail-fixed-header="true"')
  && output.includes('data-native-detail-no-horizontal-overflow="true"');
if (!pass) {
  process.stderr.write(JSON.stringify({ exitCode, outputTail: output.slice(-2_000), stderr: errorOutput }, null, 2) + "\n");
  process.exitCode = 1;
}
process.stdout.write("NATIVE_DETAIL_SCROLL_DOM=" + (pass ? "PASS" : "FAIL") + "\n");
if (pass) {
  const height = output.match(/data-native-detail-scroll-height="(\d+)"/)?.[1] ?? "?";
  const client = output.match(/data-native-detail-client-height="(\d+)"/)?.[1] ?? "?";
  const width = output.match(/data-native-detail-inner-width="(\d+)"/)?.[1] ?? "?";
  const overflow = output.match(/data-native-detail-overflow-y="([^"]+)"/)?.[1] ?? "?";
  process.stdout.write(`NATIVE_DETAIL_SCROLL_VIEWPORT=${width} OVERFLOW_Y=${overflow} SCROLL_HEIGHT=${height} CLIENT_HEIGHT=${client}\n`);
}
