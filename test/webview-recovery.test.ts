import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { APP_SHELL_HTML } from "../src/control-center-shell.js";

const repo = process.cwd();

test("WebView2 bootstrap is independent from backend readiness and has a visible fallback", () => {
  const host = readFileSync(join(repo, "windows", "desktop", "BridgeCodexAppHost.cs"), "utf8");
  assert.match(host, /NavigateToString/);
  assert.match(host, /RuntimeStatusUrl/);
  assert.match(host, /BootstrapDocument/);
  assert.match(host, /bridge-host-readiness-timeout/);
  assert.match(host, /Control Center 暂时无法加载/);
  assert.match(host, /重新加载界面/);
  assert.match(host, /重新启动 Control Center Host/);
  assert.match(host, /复制诊断/);
  assert.match(host, /打开日志/);
  assert.match(host, /NavigationAttempts >= 60/);
  assert.match(APP_SHELL_HTML, /controlCenterReady/);
  assert.match(APP_SHELL_HTML, /clientFallback/);
});

test("runtime configuration repair is explicit and package-relative", () => {
  const desktop = readFileSync(join(repo, "windows", "desktop", "LocalCodexBridge.Desktop.cs"), "utf8");
  assert.match(desktop, /bool needsSetup = ConfigureRequested/);
  assert.match(desktop, /ApplyPackageRelativeFallback/);
  assert.match(desktop, /FindBridgeRoot\(AppDomain\.CurrentDomain\.BaseDirectory\)/);
  assert.match(desktop, /LOCAL_CODEX_BRIDGE_STATUS_URL_FILE/);
  assert.match(desktop, /statusPort = "0"/);
});
