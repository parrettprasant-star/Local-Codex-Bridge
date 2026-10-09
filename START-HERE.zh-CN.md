# 从这里开始：小白安装与第一次调用

适用：Local Codex Bridge 6.2.0，Windows 10/11 x64。社区软件，未代码签名；不是 OpenAI 官方产品，也不是 ChatGPT 插件商店的公开应用。

你要做的只有五段：**准备依赖 → 解压安装 → 填自己的连接信息 → 在 ChatGPT 连接 → 发一个只读测试**。日常使用不用编译源码，不用另外手工运行 tunnel-client。

## 0. 先判断自己是否适合安装

- 使用 Windows x64，能安装 Node.js、官方 Codex CLI 和 WebView2 Runtime。
- 要从 ChatGPT 调用，还需要账号/工作区允许自定义 MCP，并拥有自己的 Secure MCP Tunnel 注册及运行 key。
- ChatGPT 权限和 Platform Tunnel 权限是两回事。没有权限时不能靠安装 Bridge 绕过，先问工作区/组织管理员。
- 本版本固定 GPT-5.6 Luna / Max；账号实际无法使用它时会停止执行，不自动换模型。

依据：[官方 Tunnel 指南](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)、[官方连接流程](https://developers.openai.com/plugins/deploy/connect-chatgpt)。

## 1. 下载正确的包

普通用户选 `LocalCodexBridge-6.2.0-windows-x64.zip`，**不要选 source.zip**。源码包是给开发者的。

同时取得 `SHA256SUMS.txt`。只从 [本项目 GitHub Releases](https://github.com/parrettprasant-star/Local-Codex-Bridge/releases/latest) 取得发布包和校验值，不要把未核实的同名网盘包当作正式下载。若 Release 还未出现，先等待发布，不从陌生来源替代。

右键 ZIP → 全部解压。选择一个短、可写的目录，例如 `C:\LCB\6.2.0`；没有根目录写权限时使用 `%LOCALAPPDATA%\LCB\6.2.0`。不要在 ZIP 内运行，不要嵌套十几层目录，不要放在只读位置。

在解压前可用 PowerShell 检查外层 ZIP：

```powershell
Get-FileHash -LiteralPath "$env:USERPROFILE\Downloads\LocalCodexBridge-6.2.0-windows-x64.zip" -Algorithm SHA256
```

将输出与可信渠道取得的 SHA256SUMS 比较。包内 manifest 用于发现损坏，不是数字签名；来源可信和外层校验也很重要。

## 2. 准备三个依赖

### Node.js 24 或更高

打开 [Node.js 官方下载](https://nodejs.org/en/download)，选择 Windows x64 的 24+ LTS 安装器。按安装器步骤完成，关闭旧终端后重新打开 PowerShell：

```powershell
node.exe --version
```

输出应为 v24 或更高。不是让你去改系统代理或 PATH 的全部内容；找不到命令时先重新打开终端。

### 官方 Codex CLI 与登录

按 [官方 Codex CLI 安装/登录文档](https://learn.chatgpt.com/docs/codex/cli) 安装。已经能运行官方 Codex 的用户不要重复安装或覆盖现有配置。

新用户可在已安装 Node/npm 后选择官方 npm 发行：

```powershell
npm.cmd install -g @openai/codex
codex --version
codex
```

首次进入 Codex 按官方界面登录自己的账号；完成登录后退出这次 CLI 即可。不提供密码、验证码或 auth.json 给 Bridge。npm 安装方式依据 [OpenAI 官方安装示例](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)。

Bridge 配置需要真正的 **codex.exe**，不是 codex.cmd / codex.ps1 / codex.js。若向导没有自动发现，先运行：

```powershell
Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
```

如果使用 npm 方式且没有输出，可仅在 npm 的官方包目录中查找：

```powershell
Get-ChildItem -LiteralPath "$env:APPDATA\npm\node_modules\@openai" -Recurse -File -Filter codex.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
```

把找到的 x64 官方 codex.exe 完整路径填入向导。自定义 npm prefix 则查对应的安装目录；找不到就停在依赖问题，不使用来历不明 EXE，不修改 `.codex` 来碰运气。

### Microsoft WebView2 Runtime

从 [Microsoft 官方页面](https://developer.microsoft.com/microsoft-edge/webview2/#download-section) 安装 Evergreen Runtime。很多 Windows 11 已有它；已有时无需重复安装。**Edge 浏览器、WebView2 Runtime、开发者 SDK 是不同东西**；普通用户不需要下载 SDK。[微软说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。

## 3. 一次安装桌面入口

在完整解压目录中双击 **install.cmd**。它调用随包安装脚本，先检查完整包，再创建一个 Local Codex Bridge 桌面快捷方式。

或在解压目录的资源管理器地址栏输入 `powershell` 并回车，只粘贴这一条：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-portable.ps1 -PackageDirectory .
```

`Bypass` 只作用于这个已校验脚本的子进程，不永久修改系统执行策略。不要管理员运行，不关闭防护。如果公司策略禁止脚本执行，遵循组织政策，不绕过。

安装器**不会**下载依赖、启动任务、创建云端注册、填密钥、删除历史或设置开机自启。成功会输出快捷方式路径。所有文件必须一起保留，不能只把 EXE 拷到桌面。

已有另一个 Local Codex Bridge 入口时，脚本会保留它并报冲突，不生成 `(2)`。先确认新包，再按 [使用手册的升级章节](USER-GUIDE.zh-CN.md#升级回滚与卸载) 明确切换；不要盲目增加替换参数。

## 4. 首次配置

双击桌面 Local Codex Bridge。如果没出现向导，点击 Windows 右下角托盘的 Bridge 图标 → **配置向导**。

| 向导字段 | 怎么填 |
|---|---|
| Node.js 可执行文件 | 自动发现的 node.exe；必要时用 `Get-Command node.exe` 查路径 |
| 官方 Codex CLI | 自己安装的官方 codex.exe 完整路径 |
| Bridge 工作目录 | 本次完整解压目录，通常自动填好；这不是任务项目目录 |
| 状态 API | 保留自动值，仅本机 loopback；不要填写公网地址 |
| Tunnel client | 包内 tunnel-client.exe，通常自动发现 |
| Tunnel profile | 保留默认，宿主生成运行配置；不复制别人的 profile |
| 自己的 Tunnel ID | 从自己的 Platform Tunnel 页面取得，不能使用文档示例 |
| Runtime API Key | 只在遮罩输入框中输入自己的运行 key |
| 直接启动 Bridge Node | 保持推荐值 |
| 启动已配置 Tunnel | 要连接 ChatGPT 时勾选 |
| 随 Windows 启动 | 初次使用保持不勾选 |

自己的 Tunnel 在 [OpenAI Platform Tunnel 设置](https://platform.openai.com/settings/organization/tunnels) 创建/管理，并关联目标 ChatGPT 工作区。此版本接受 `tunnel_` 加 32 位小写十六进制的已验证 ID；出现其他格式时先停下核对兼容性，不删前缀、不伪造 ID。

**保存配置 → 托盘真退出 → 再双击桌面启动**。密钥用当前 Windows 用户 DPAPI 加密，仅在本机保存。不要把 key 放进聊天、截图、YAML 或 GitHub。

先看诊断：Bridge 已连接，Tunnel/registration 已就绪，Plugin transport 已就绪。Codex 可以显示 lazy-ready，首次需要它时才启动，并不表示断线。

## 5. 在 ChatGPT 连接

1. 使用 ChatGPT 网页，打开 Plugins/自定义 MCP 管理页。
2. 添加 custom MCP server，名称填 Local Codex Bridge。
3. Connection 选择 **Tunnel**，选择自己的 Tunnel 或填写同一个 ID。
4. 阅读风险提示并自行授权；账号缺少此入口时先解决官方权限。
5. 确认扫描到 13 个工具，包括 get_agent_list / get_capabilities。
6. 开一个新对话，输入 `@` 选择 Local Codex Bridge，再发送下面的第一条指令。

这是私有连接，不要把 `127.0.0.1` 状态地址作为公网 MCP URL，也不要求你的电脑直连 OpenAI internal gateway。[官方步骤](https://developers.openai.com/plugins/deploy/connect-chatgpt)。

### 第一条：只验证连接，不执行任务

```text
请实际调用 Local Codex Bridge 的 get_agent_list，
再调用 get_capabilities(agent_id="codex_local")。
报告工具是否真正发出、实际 Agent 和已启用能力。
不要创建任务、读会话内容、执行命令或写文件。
如果本对话没有这两个工具，明确报告 BLOCKED_BEFORE_CALL，
不要把普通文字回答当作插件测试成功。
```

### 第二条：确认后做最小任务

从 [调用指令示例](CHATGPT-PROMPTS.zh-CN.md) 复制只读任务示例，把工作目录换成自己已存在的项目目录。它会创建一个正常 native 测试线程，不是完全无状态的 discovery；不要在没有授权时替你创建。

更多页面、历史分页、错误排查、费用边界和安全卸载见 [完整使用手册](USER-GUIDE.zh-CN.md)。不想自己操作命令时，可复制 [AI 辅助安装指令](CHATGPT-PROMPTS.zh-CN.md#让本机-ai-协助安装) 给有本机工具权限的助手，但登录/注册/授权仍由你完成。
