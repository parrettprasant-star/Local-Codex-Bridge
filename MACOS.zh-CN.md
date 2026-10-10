# Mac 安装与使用：浏览器 Control Center 预览

**不是 Windows EXE，不是 notarized `.app`。** Windows 6.2.0 正式包不变；Mac 为独立预览，Apple Silicon / Intel 分别构建。实际 Mac ChatGPT Cloud 验收之前，不标为 Mac 正式版。CI 和本地工具测试也不能代替 Cloud 实测。

## 最简单的路线

先打开官方**本机 Codex**，复制 [一句安装指令](CHATGPT-PROMPTS.zh-CN.md#一句话开始安装windows--mac)。Codex 会逐步带你检查系统、依赖和权限；本人登录、Tunnel 注册、密钥输入和系统授权不能被提示词绕过。尚未接通的网页插件不能反过来安装本机。

## 0. 系统与账号条件

- Node.js 24+、可用的官方 Codex CLI。装了 Codex Desktop 不一定有 CLI。
- 验证范围：macOS 15 的 Intel / Apple Silicon；不承诺旧 macOS、Linux 或所有架构。
- 自己的 ChatGPT/工作区允许自定义 MCP，自己的 Platform 组织有 Tunnel 注册/管理/使用权限。这是两组不同权限，下载公开软件不自动取得。
- 沿用既有 GPT-5.6 Luna / Max 策略。账号不支持时会拒绝，不伪造或自动替换模型。
- 组织、地区、套餐和网络限制仍可能影响连接；不是人人下载即开箱连通。

依据：[官方 Codex CLI](https://learn.chatgpt.com/docs/codex/cli)、[官方私有 Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。

## 1. 下载与完整性检查

在 [GitHub Releases](https://github.com/parrettprasant-star/Local-Codex-Bridge/releases) 选择与芯片一致的 Mac **preview**：M 系列 `macos-arm64`，Intel `macos-x64`。只看到 `windows-x64` 就不能当成 Mac 软件。没有 Mac 包时等待，或在独立源码 checkout 构建；不猜下载地址、不复制 Windows `.exe`。

解压到用户可写目录，例如 `~/Applications/LocalCodexBridge`，不要覆盖现有版本。Mac 包使用 `.tar.gz` 保留 Tunnel 的执行权限；下载可信 SHA256SUMS 后检查压缩包：

```sh
shasum -a 256 "$HOME/Downloads/LocalCodexBridge-macos-arm64-preview.tar.gz"
```

替换成实际文件名，与可信发布页比较。校验不等于代码签名。本社区 Mac binary 未公证；被 Gatekeeper 拦截时先核验来源/架构，不关闭系统保护，不擅自执行 `xattr -dr`。

源码路线：在**新 checkout** 运行 `npm ci`、`npm run typecheck`、`npm run build:staging`、`npm run build`。独立 Mac 包由 `scripts/build-macos-package.mjs` 校验固定官方 Tunnel 源码、构建依赖修复版、执行已知漏洞扫描并保留许可证/provenance；安全检查失败不能跳过。

## 2. 依赖与本人登录

从 [Node.js 官方](https://nodejs.org/en/download) 安装匹配芯片的 Node 24+；按 [Codex CLI 官方说明](https://learn.chatgpt.com/docs/codex/cli) 安装，由本人登录。已有正常依赖不重复覆盖。

```sh
node --version
codex --version
which codex
uname -m
```

成功标志：Node v24+；Codex 能运行且本人已登录；`which codex` 返回真实路径；芯片通常为 `arm64` 或 `x86_64`。安装依赖/授予系统权限前，助手应先说明作用，不能重置 `.codex` 来解决安装问题。

## 3. 一次配置

本人在 Platform 注册自己的 Tunnel，配置正确组织权限/ChatGPT 工作区。仅使用本人 ID/key，不复制其他人的注册。当前只接受已验证的 `tunnel_` 后接 32 位十六进制 ID；其他格式先停下，不删除注册来猜。

```sh
cd "$HOME/Applications/LocalCodexBridge"
node scripts/macos-bridge.mjs setup
```

向导依次要求：自己的 Tunnel ID → Tunnel client 绝对路径（完整包可回车）→ Codex CLI 路径（检测正确可回车）→ 可选真实项目目录 → 个人控制面 API key。

密钥**隐藏输入**，只存当前用户 macOS 钥匙串；系统授权由本人确认。不放在命令参数、JSON/YAML、聊天、Git 或日志。钥匙串不成功即停止，不改成明文保存。高级用户可从自己的安全本机环境提供 `CONTROL_PLANE_API_KEY`，不能把真实 `export ...` 粘贴进聊天。

状态目录：`~/Library/Application Support/LocalCodexBridge`。只保存 Bridge 自己的配置、任务和运行态；不复制/重建 `.codex`。重配先保留配置/项目备份。可选项目注册为 `my-project`，默认只启用 `file_read`，不创建目录；ChatGPT 后续用 `project_id`，不需要每次输入 cwd。

## 4. 每天启动、使用、退出

```sh
node scripts/macos-bridge.mjs doctor
node scripts/macos-bridge.mjs start
```

`doctor` 只检查本机依赖/配置，不创建会话。`start` 管理自己启动的 Tunnel/MCP child，浏览器显示总览、Native Threads、AGENTS、Scheduled Tasks、诊断；端口来自当前私有状态，不手写 Windows 固定端口。

**终端保持运行。关闭浏览器不是退出；回终端按 Ctrl+C 才是真退出。** 自己的 Bridge child 先关闭自己拥有的 app-server，再关闭 Tunnel，不按 Node/Codex 名称杀进程。Mac 没有 Windows 的 X→托盘，也不自动加入登录项；不是同一个 GUI。

真实 parent/child、generation 和 `/readyz` 都有效才 Ready；失效立即取消 Ready，最多 3 次退避恢复，不无限重启。

## 5. ChatGPT 网页添加插件

按 [跨平台插件配置](CHATGPT-PLUGIN-SETUP.zh-CN.md)：添加自定义 MCP → Tunnel → **同一个本人 Tunnel ID** → 本项目 stdio MCP 使用 No authentication → 阅读提示、本人授权 → 新对话选择插件 → 真实只读调用 `get_agent_list` / `get_capabilities`。

API key 仅在本机，不能填入 ChatGPT 表单/聊天。不要要求电脑直接 curl OpenAI internal gateway 判断 Cloud 成败。先验证发现，再给自己授权的项目发任务。

## 6. 错误、升级、卸载与隐私

| 现象 | 正确处理 |
|---|---|
| 没有自定义 MCP/Tunnel 入口 | 账号/组织权限阻塞，软件不能绕过，不共享维护者 key |
| doctor 失败 | 检查 Node、`dist/src/index.js`、实际可执行路径/芯片；不重置 Codex |
| 钥匙串失败 | 本人处理系统许可或重跑 setup；不公开 key、不删除 auth |
| Tunnel 异常/刷新失败 | 检查本人权限/ID、真实 transport、是否选择新对话插件，分层诊断 |
| cwd 不存在 | 使用本人现有 `/Users/...` 项目，不用安装目录或 Windows `C:\` |
| Scheduled Tasks 空 | 缺少官方数据库可为空；不制造记录，不混入 Native Threads |

更新：Ctrl+C 真退出 → 新目录安装验证 → 保留旧目录回滚；不同时启动同一 Tunnel 的两个 client。降级出现 schema 不兼容先保留备份，不清库。

卸载默认只移除已确认的 Bridge 程序目录。Bridge 状态和钥匙串是否保留由本人选择；不批量清理钥匙串，不删 `.codex`/sessions/history、用户项目、ChatGPT 数据，不停原生 Codex Desktop。

会话/目录/结果可能含隐私，提交 ChatGPT 或 GitHub 前先授权/脱敏。Agent 标签不是系统沙箱；Codex sandbox/approval 仍是执行边界。模型/API用量成本由本人承担，不承诺所有账号免费可用。
