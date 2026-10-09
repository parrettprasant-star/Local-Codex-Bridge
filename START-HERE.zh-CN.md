# 从这里开始：小白安装与第一次调用

适用：Local Codex Bridge 6.2.0，Windows 10/11 x64。社区软件，未代码签名；不是 OpenAI 官方产品，也不是 ChatGPT 插件商店的公开应用。

你要做的只有五段：**准备依赖 → 解压安装 → 填自己的连接信息 → 在 ChatGPT 连接 → 发一个只读测试**。日常使用不用编译源码，不用另外手工运行 tunnel-client。

## 先看这一页：安装路线

如果你第一次用 GitHub 或没用过命令行，先照这张表走。安装依赖只做一次；之后正常使用只需打开桌面快捷方式。

| 顺序 | 你实际要做的事 | 成功标志 / 不成功怎么办 |
|---|---|---|
| ① 先确认账号 | 看下面第 0 节，确认自己的 ChatGPT 和 Platform 有相应权限 | 能添加自定义 MCP、能管理/使用自己的 Tunnel；没有入口就先停在权限问题 |
| ② 下载和解压 | 打开 Release 页的 Assets，下载 `windows-x64.zip` 和校验文件，右键“全部解压” | 新目录里能直接看到 `LocalCodexBridge.exe`、`install.cmd` 和 `dist` 文件夹 |
| ③ 准备依赖 | 安装 Node 24+、官方 Codex CLI 并登录、WebView2 Runtime | Node 能显示版本，Codex 能打开并完成本人登录；没有错误再继续 |
| ④ 安装桌面入口 | 在解压后的目录双击 `install.cmd` | 输出 Complete，桌面出现一个 Local Codex Bridge；报错时窗口停在那里，不当作安装成功 |
| ⑤ 填连接信息 | 打开 Bridge 的“配置向导”，填写自己的 Tunnel ID 和运行 key | 保存成功，然后从托盘真退出再启动；诊断里 Tunnel / Plugin 已就绪 |
| ⑥ 在 ChatGPT 连接 | 网页中添加自己的 Tunnel MCP，安装/连接插件，开新对话选择它 | 实际工具目录有 13 个工具；只看到软件窗口还不算连接成功 |
| ⑦ 第一次调用 | 粘贴本页第 5 节的连接检查指令 | `get_agent_list` 和 `get_capabilities` 真正返回；之后才做只读测试任务 |

**不要点 GitHub 绿色 Code → Download ZIP 来安装软件。** 那是源码，不是 Windows 运行包。Release 页面下方的 Assets 才有这里需要的 Windows ZIP。

### 这些词是什么意思

| 词 | 用小白能理解的话解释 |
|---|---|
| Node.js | Bridge 的一个运行依赖；不是你要学习的编程任务 |
| Codex CLI | 官方 Codex 的命令行程序，负责实际执行；装了 Codex Desktop 不一定代表 CLI 已在 PATH 中 |
| WebView2 Runtime | 让 Windows 软件显示网页界面的微软组件，不是开发者 SDK |
| Tunnel | 让 ChatGPT 安全连接你电脑的通道；每个人使用自己的注册 |
| Runtime API Key | Tunnel 连接 OpenAI 时用的运行凭据；不是 ChatGPT 密码，也不是让你粘贴到聊天里的内容 |
| 工作目录 / cwd | 这次任务要操作的真实项目文件夹，不是 Bridge 的安装目录 |
| 托盘 | Windows 右下角的小图标区；被隐藏时先点 `^` 展开，再右键 Bridge 图标 |

下面是每一步的详细操作。不知道该填什么时停下来查看对应章节，不照抄示例 key/ID，也不尝试清理自己的会话数据。

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

本页代码框旁边的复制按钮只复制命令，不复制 `powershell` 这个标题。在 Windows 开始菜单搜索“PowerShell”，打开普通窗口即可；不需要以管理员身份运行。上面的命令假设文件在默认“下载”目录；实际不在这里就换成自己的 ZIP 路径，不能把“找不到文件”当作校验通过。

解压完成后，如果资源管理器显示扩展名被隐藏，`install`（Windows 命令脚本）就是 `install.cmd`。可以在资源管理器“查看 → 显示 → 文件扩展名”打开扩展名显示；不要运行 ZIP 内的文件。

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

这三条在 PowerShell 中逐条执行：第一条安装，第二条应显示版本，第三条进入官方登录界面。不要在登录界面顺手提交任务。完成后用官方界面退出；常规终端可按 Ctrl+C。如果公司不允许全局 npm 安装，停下来遵循组织政策，不使用提权或清空配置来绕过。

Bridge 配置需要真正的 **codex.exe**，不是 codex.cmd / codex.ps1 / codex.js。若向导没有自动发现，先运行：

```powershell
Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
```

如果使用 npm 方式且没有输出，可仅在 npm 的官方包目录中查找：

```powershell
Get-ChildItem -LiteralPath "$env:APPDATA\npm\node_modules\@openai" -Recurse -File -Filter codex.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
```

把找到的 x64 官方 codex.exe 完整路径填入向导。自定义 npm prefix 则查对应的安装目录；找不到就停在依赖问题，不使用来历不明 EXE，不修改 `.codex` 来碰运气。

如果查到多个架构，Windows x64 使用对应 `x86_64` / `x64` 的官方二进制，不选 ARM64。`codex --version` 成功和找到真正的 `codex.exe` 是两项检查；Bridge 不能拿 `codex.cmd` 当原生 EXE 使用。

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

如果还没有连接信息：先登录自己的 Platform 账号，在 Tunnel 设置按官方流程创建/管理 Tunnel；确认它关联了接下来使用的 ChatGPT 工作区，再按页面和 [官方 Tunnel 指南](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 获取运行凭据。找不到入口、角色权限不足或 ID 格式不兼容时就停在这里，Bridge 安装器不能替你开通。不要把 ChatGPT 密码、验证码、别人的 ID 或普通配置示例填进去。

**保存配置 → 托盘真退出 → 再双击桌面启动**。密钥用当前 Windows 用户 DPAPI 加密，仅在本机保存。不要把 key 放进聊天、截图、YAML 或 GitHub。

先看诊断：Bridge 已连接，Tunnel/registration 已就绪，Plugin transport 已就绪。Codex 可以显示 lazy-ready，首次需要它时才启动，并不表示断线。

## 5. 在 ChatGPT 连接

1. 使用 ChatGPT 网页，打开 [Plugins](https://chatgpt.com/plugins)/自定义 MCP 管理页。入口名称可能因界面语言/账号政策不同；没有此入口先核对官方权限，而不是反复安装 Bridge。
2. 添加 custom MCP server，名称填 Local Codex Bridge。
3. Connection 选择 **Tunnel**，选择自己的 Tunnel 或填写同一个 ID。
4. 如果表单要求 Authentication，本版本 Bridge MCP stdio 本身没有 OAuth 登录服务，选择 **No authentication / 无身份验证**；Tunnel 的账号权限和运行 key 仍单独生效。不要把 Runtime API Key 填进 OAuth Client ID/Secret，也不要把它发给 ChatGPT。只有自行部署了额外认证层的高级用户才应按其服务选择其他方式。
5. 阅读风险提示并自行授权，创建后安装/连接这个插件；仅创建条目还不等于当前对话已可调用。
6. 确认扫描到 13 个工具，包括 get_agent_list / get_capabilities。注意工具可能被手动禁用，先看插件详情。
7. 开一个新对话，输入 `@` 选择 Local Codex Bridge，再发送下面的第一条指令。

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

成功应能看到真实工具调用和返回：Agent ID 包含 `codex_local`，随后能力查询返回实际启用状态。`BLOCKED_BEFORE_CALL` 的意思是“调用还没发出”，不是电脑文件丢失；回到插件连接/启用步骤排查，不重新提交执行任务。

### 第二条：确认后做最小任务

从 [调用指令示例](CHATGPT-PROMPTS.zh-CN.md) 复制只读任务示例，把工作目录换成自己已存在的项目目录。它会创建一个正常 native 测试线程，不是完全无状态的 discovery；不要在没有授权时替你创建。

更多页面、历史分页、错误排查、费用边界和安全卸载见 [完整使用手册](USER-GUIDE.zh-CN.md)。不想自己操作命令时，可复制 [AI 辅助安装指令](CHATGPT-PROMPTS.zh-CN.md#让本机-ai-协助安装) 给有本机工具权限的助手，但登录/注册/授权仍由你完成。

## 安装完以后，每天怎么用

1. 开电脑后，双击桌面 **Local Codex Bridge**；等 Tunnel / Plugin 已就绪。
2. 去 ChatGPT 的新对话选择自己的 Bridge 插件，说清项目目录和任务；先从不敏感、只读的小任务开始。ChatGPT 不会因为装了这个软件就自动拥有整台电脑的权限。
3. 在 Bridge 总览看真实运行状态，在 Native Threads 或任务详情看结果；执行完成还需要自己审阅结果。
4. 暂时关窗口可点 X，服务留在托盘；想断开本机服务时，右键托盘选退出。退出 Bridge 后 ChatGPT 暂时无法通过该 Tunnel 调用本机，这是正常行为。

首次测试不要求你编辑项目注册 JSON，不要求读懂 13 个工具的所有参数，也不要求运行源码的 `npm test`。这些属于进阶使用和开发者检查。
