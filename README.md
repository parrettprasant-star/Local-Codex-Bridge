# Local Codex Bridge

**ChatGPT ↔ local Codex Agent control center for Windows.**

Community software, not an official OpenAI product. Version 6.2.0 is an unsigned
Windows community package. Published downloads and checksums are listed in
[GitHub Releases](https://github.com/parrettprasant-star/Local-Codex-Bridge/releases).
This is not a public ChatGPT App Store submission.

## 中文安装与使用

第一次使用请从 [小白快速安装](START-HERE.zh-CN.md) 开始。下载 Windows ZIP，
完整解压到短目录后双击 `install.cmd`，不需要编译源码。

这是让 ChatGPT 使用你电脑上 Codex 的桥梁，不是另一个 ChatGPT，也不是一个
下载后就自动取得账号权限的插件。**先确认自己的账号可以使用自定义 MCP / Tunnel，
再安装；日常使用从桌面快捷方式启动，第一次配置只做一次。**

| 你现在想做什么 | 从哪里开始 |
|---|---|
| 第一次安装，不懂代码 | [安装路线与每一步成功标志](START-HERE.zh-CN.md#先看这一页安装路线) |
| 想让本机 AI 帮忙安装 | [复制安装指令](CHATGPT-PROMPTS.zh-CN.md#让本机-ai-协助安装)；登录/授权仍由本人完成 |
| 已安装，想让 ChatGPT 使用 | [连接 ChatGPT](START-HERE.zh-CN.md#5-在-chatgpt-连接)，先验证连接，再提交任务 |
| 只想在 Bridge 内做独立任务 | [AGENTS 的用法](USER-GUIDE.zh-CN.md#agents) |
| 出错、升级或卸载 | [常见问题](USER-GUIDE.zh-CN.md#常见问题)、[升级回滚与卸载](USER-GUIDE.zh-CN.md#升级回滚与卸载) |

Windows ZIP 不包含 Node、你的 Codex 安装或账号认证。`install.cmd` 是本地完整性
检查和桌面入口安装，不会替你安装所有依赖或自动注册 Tunnel。

[下载 Windows 包](https://github.com/parrettprasant-star/Local-Codex-Bridge/releases/latest)
（选择 `LocalCodexBridge-6.2.0-windows-x64.zip` 和 `SHA256SUMS.txt`；源码包供开发者使用）。

- [完整使用手册](USER-GUIDE.zh-CN.md)：页面、任务、历史、排错、升级/回滚/卸载。
- [可复制指令](CHATGPT-PROMPTS.zh-CN.md)：AI 辅助安装、连接检查、第一次只读任务。
- [隐私与公开边界](PRIVACY-RELEASE.zh-CN.md)：哪些不上传、使用时哪些内容可能发给 ChatGPT。

账号登录、自己的 Tunnel 注册/key 和 ChatGPT 授权仍需本人完成。
安装脚本不下载未知代码、不开启自启动、不自动执行任务。

## Install / upgrade / rollback

Windows 10/11 x64, Node.js 24+, the independently installed official Codex CLI
and Microsoft WebView2 Runtime are prerequisites. Codex authentication stays in
the official CLI; Bridge never requests or packages your Codex credentials.

1. Extract the verified release ZIP to a short folder, such as
   `C:\LocalCodexBridge\6.2.0`. Do not run inside a ZIP or an excessively long path.
2. Run `./verify-release-package.ps1 -PackageDirectory .` before first launch.
   This checks every packaged hash and version. Checksums are not code signing.
3. Run `./install-portable.ps1 -PackageDirectory .` for the single desktop
   shortcut. A different existing target is preserved by default; after testing
   use `-UpdateDesktopShortcut` explicitly. Its old shortcut is backed up under
   `%LOCALAPPDATA%\BridgeCodex\ShortcutBackups`. No autostart is added.
4. Open Bridge. Tray → configuration: check Node/Codex paths and enter **your own**
   Tunnel ID and Runtime API Key for ChatGPT. Select the included or separately
   verified client. Save, true-exit, then restart. See TUNNEL-SETUP.md.
5. Verify real readiness and a read-only ChatGPT call. Local tools/list does not
   prove Cloud connectivity. Advanced Agent capabilities remain gated below.

Upgrades do not copy/delete `.codex`, sessions, AppData or user task history.
Keep the previous package until testing succeeds. Rollback: true-exit the new
Bridge, restore the old shortcut/target and launch the old package. Never overlap
two stdio clients bound to one Tunnel ID.

Uninstall: true-exit, remove the matching shortcut and package folder only.
Keep AppData, `.codex`, logs and credentials unless removal is separately requested.
Never stop native Codex Desktop. Unsigned community binaries may be blocked by
Windows/security software: verify provenance, do not disable protection blindly.

## What it does

- A local MCP stdio facade for native persistent Codex threads.
- A Control Center with Overview, Native Threads, AGENTS, Scheduled Tasks and Diagnostics.
- Independent ephemeral AGENTS jobs, separate from persistent native threads.
- An initial Agent Gateway and read-only Project Registry.
- Bounded task summaries and Result Manifests, without replacing native Codex history.

## Current MCP catalog: 13 tools

| Tools | Purpose |
|---|---|
| `codex_threads`, `codex_observe` | Native history and bounded live supervision |
| `codex_turn`, `codex_steer`, `codex_respond`, `codex_interrupt` | Explicit native turn control; acceptance is not completion |
| `codex_checkpoint` | Optional bounded supervision metadata |
| `create_agent_task`, `get_task_status` | Initial Codex Agent task/Result Manifest facade |
| `list_projects`, `get_project` | Read configured project metadata |
| `get_agent_list`, `get_capabilities` | Discover actual enabled providers/capabilities |

The initial Agent Gateway executes with the existing read-only policy. A provider
advertising a future capability does not mean that capability is enabled now.
There is no Work Agent or automatic multi-Agent routing in this snapshot.

## Developer verification

Windows, Node.js 24+, npm, and an independently installed official Codex executable
are required for actual Codex execution. Discovery-only smoke does not start Codex.

```powershell
npm ci
npm run typecheck
npm test
npm run smoke:catalog
```

For a strict stdio MCP client, build and run Node directly:

```powershell
npm run build
node dist/src/index.js
```

Do not use `npm start` as a strict MCP transport command: npm emits lifecycle output.
Execution tests that create persistent threads require explicit authorization.

## Reproducible Windows package

The desktop host source is included. WebView2 SDK restoration is checksum-pinned
and preserves its official LICENSE/NOTICE. On a clean Windows checkout:

```powershell
./scripts/restore-webview2.ps1 -OutputDirectory .staging/sdk-clean
./scripts/build-release-package.ps1 -WebViewSdkDirectory .staging/sdk-clean -OutputDirectory artifacts/Dev1 -BuildLabel developer-review
./windows/desktop/test-desktop.ps1 -Executable artifacts/Dev1/LocalCodexBridge.Desktop.exe
```

Use a fresh short output directory; packages are never overwritten. The default
developer package intentionally omits Tunnel; a full package takes a verified
dependency-repair output via `-TunnelDirectory`. See THIRD-PARTY.md for its build.
Install the WebView2 Runtime independently. See THIRD-PARTY.md and TUNNEL-SETUP.md.
No maintainer Tunnel ID, DPAPI key, local task store, project registry, browser
profile, or private screenshot is included.

Source publication is not public ChatGPT plugin distribution. Secure MCP Tunnel
is a private/developer connection path; public plugins need a stable public HTTPS
endpoint. Remote ChatGPT setup requires the user's own valid Tunnel registration and
credentials. This release does not promise automatic provisioning for every
ChatGPT account. Do not expose the local status server to a LAN or the Internet.
Read SECURITY.md and RELEASE-GATES.md before any public deployment.

Scheduled Tasks reads a local automation database when available; it does not
promise to list all ChatGPT cloud scheduled tasks. Bridge is not an OS sandbox.

## License

Project source: MIT; see LICENSE. Third-party runtimes have their own terms.
The project license does not grant rights to redistribute third-party binaries.
