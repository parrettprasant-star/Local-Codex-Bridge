# Local Codex Bridge 使用手册

适用 6.2.0 / Windows x64。第一次使用先读 [快速安装](START-HERE.zh-CN.md)。程序为未签名社区构建，下载以 [GitHub Releases](https://github.com/parrettprasant-star/Local-Codex-Bridge/releases) 为准；本手册不承诺任意账号都有 Tunnel/MCP 权限。

## 这个软件做什么

它把 ChatGPT 的 MCP 工具请求转给你自己电脑上的官方 Codex。控制中心负责看状态、看会话、看独立任务和诊断；不是新的聊天数据库，也不替代原生 Codex Desktop。

```text
ChatGPT → 自己的 Secure MCP Tunnel → 本机 Bridge → 官方 Codex
                                      ├ Native Threads：持久会话
                                      ├ AGENTS：独立临时执行
                                      └ Scheduled Tasks：本机自动化只读视图
```

GitHub 下载软件与私有 ChatGPT 连接是两件事。每个人需要自己的注册/key，不能共用维护者 Tunnel。Secure MCP Tunnel 私有接入的边界见 [官方文档](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。

## 日常使用：先选一种方式

| 你想做的事 | 使用路线 | 结果到哪里看 |
|---|---|---|
| 让 ChatGPT 调用本机 Agent | 启动 Bridge → Tunnel/Plugin 就绪 → ChatGPT 选择插件 → 先验证连接 → 明确提交一次任务 | ChatGPT 的实际返回、Bridge 总览及对应 Native Thread/任务详情 |
| 查看或继续已有 Codex 会话 | Native Threads → 搜索/选择会话 → 看详情；需要续写才点“继续这个线程” | 该准确 thread_id 的详情，不另建会话 |
| 不经过 ChatGPT，手动做独立任务 | AGENTS → 新建独立任务 → 选择真实项目目录 → 输入描述 → 发送 | AGENTS 任务详情里的事件和输出；它不变成 Native persistent history |

第一次只要理解上面三条，不需要记工具名。没有已注册项目时可以直接使用真实 `cwd`，不用先编辑 JSON；没有历史会话/自动化时相应页面为空是正常情况。

任务描述要说清“要做什么、可以读哪个目录、不能做什么、期望返回什么”。第一次建议复制 [最小文本测试](CHATGPT-PROMPTS.zh-CN.md#3-最小文本任务会创建持久线程)，将示例工作目录换成自己已经存在、不敏感的目录；不要选密码库、认证目录或整个用户目录。

## 启动、隐藏、恢复、真退出

- 日常启动：桌面 Local Codex Bridge。别在多个目录同时运行多个版本。
- 第一次无有效窗口记录默认最大化；以后恢复有效的正常尺寸或最大化状态。
- 点窗口 X：隐藏到托盘，Bridge/Tunnel 继续运行，不是真退出。
- 从托盘重新打开：恢复窗口，不创建第二实例。
- 停止本地服务：托盘菜单的退出项，完成 owned 子进程清理后退出。
- 修改配置后：保存 → 真退出 → 再启动。正常退出不会结束你手工打开的原生 Codex Desktop。

安装器不默认启用开机自启。请先确认生命周期/连接正常，再自行决定是否启用现有配置开关。

## 页面说明

| 页面 | 你可以做什么 | 注意 |
|---|---|---|
| 总览 | 看 Bridge/Tunnel/Plugin/Codex 状态、真实正在执行、最近 5 条会话 | queued 是等待，recovery_required 不是仍在运行 |
| Native Threads | 搜索、分页、打开持久会话、看最近内容、继续指定线程 | 直接读取 native 数据，不要求重启 Codex Desktop 刷新 |
| AGENTS | 新建 ephemeral 独立任务、看详情/事件/结果、使用实际可用控制 | 进程丢失不能恢复的任务应结束并重新提交，不能假称续跑 |
| Scheduled Tasks | 看本机 automation 及运行结果 | 只读，不等于全部 ChatGPT 云端已安排任务，也不混入 Native Threads |
| 诊断 | 真实 health、注册/transport、build/hash、原始 JSON | 分享前检查路径/会话名；不要上传密钥、原始 JSON/日志全集 |

### Native Threads 与大历史

列表只加载 metadata，点选才读详情。大历史先显示最近部分和“历史较大，已分页加载”，用详情中的继续加载操作按需读更早内容。右侧正文独立滚动，标题区固定；不会为了显示一页一次读取全部大 JSONL。

会话内容来源于官方 Codex 原生历史。notLoaded、服务不可用、读取失败不等于会话丢失；先看诊断，不删除 sessions，不重建全部索引。

继续线程时核对 thread_id，使用“继续这个线程”；不要为了续写创建另一个 thread。停止 active turn 只作用于该准确回合，不是杀掉全部 Codex。

### AGENTS

进入 AGENTS → 新建独立任务 → 填描述/可选标题 → 选择已存在的项目目录 → 发送。模型 GPT-5.6 Luna、推理强度 Max 是当前只读策略展示，不是坏掉的下拉框。Ctrl+Enter 发送，Enter 换行。

任务详情保留输入、cwd、阶段、事件、结果/错误。取消中不能当已取消；需要处理/已中断不能继续显示旧百分比。仅使用界面当前实际提供的操作，不宣称此版本支持任意进程暂停或恢复。

### 状态与结果

| 看到的状态 | 含义/下一步 |
|---|---|
| 排队/启动中/执行中 | 等待真实状态，不重复提交同一任务 |
| 等待确认 | 看准确 pending request，用户作出相应决定 |
| completed / DONE | 执行终态；还要看结果清单，不只看一句“完成” |
| failed / ERROR | 看错误、缺失输出、失败阶段，不自动重试危险操作 |
| recovery_required / 需要处理 | 需决定如何结束/重新提交；不是还占 Worker 的执行任务 |
| interrupted / cancelled | 已中断/取消，历史仍可查看 |

Result Manifest 的 review READY 表示可审阅，不是你已经确认质量。integrity PASS 仅说明声明的输出契约通过检查；纯文本任务可以合法有 0 个文件。任务要求文件却没有它，不应当按成功处理。

## 在 ChatGPT 使用

推荐顺序：连接 discovery → 查询项目 → 明确任务 → 状态查询 → 审阅 Result Manifest。完整可复制模板见 [调用示例](CHATGPT-PROMPTS.zh-CN.md)。

| 工具 | 用途 |
|---|---|
| get_agent_list / get_capabilities | 看真实 provider 和当前启用能力 |
| list_projects / get_project | 查询已经注册的本地项目，不能用它们自动新增目录 |
| create_agent_task | 创建 Codex Agent 任务，给 project_id 或真实 cwd |
| get_task_status | 用返回的 task_id 查询，不创建/重启任务 |
| codex_threads | list/search/read 持久线程 |
| codex_turn | 明确创建/继续 native turn，accepted 不是完成 |
| codex_observe | 看有界实时状态，observe 本身不是新任务 |
| codex_steer / codex_respond | 纠正准确 active turn / 回复真实 pending request |
| codex_interrupt | 中断准确 native turn，不控制所有进程 |
| codex_checkpoint | 可选有界监督锚点，不是新的 history |

Gateway 的 provider metadata 含未来能力，但当前 file_write/terminal/code_execution 在此入口 gated，不能从 get_agent_list 的 advertised 名称推断已经启用。原七个 native 工具仍按各自语义/官方权限执行，Bridge 不是操作系统沙箱。

连接工具变更后，在 ChatGPT 插件管理页 Refresh，核对 metadata，打开新对话再试。如果新对话没有工具，先报告 BLOCKED_BEFORE_CALL，别继续让模型凭文字推测执行过。界面入口受账号/工作区政策影响。[官方刷新流程](https://developers.openai.com/plugins/deploy/connect-chatgpt)。

## 可选：让 ChatGPT 只记 project_id

目前 Project Registry 读取本机 `%LOCALAPPDATA%\BridgeCodex\projects.json`，不存在时 list_projects 返回空，是正常状态。没有假造的“自动注册按钮”或 MCP register_project。

熟悉配置的用户可在真退出后，备份已有 projects.json，再用随包 `projects.json.example` 的结构编辑自己的文件。将示例 root_path 换成自己已存在的真实目录，project_id 要唯一，初次只允许 file_read。不要把文件上传仓库。

```json
{
  "schema_version": 1,
  "projects": [
    {
      "project_id": "demo_project",
      "project_name": "示例项目",
      "root_path": "C:\\Projects\\Demo",
      "allowed_capabilities": ["file_read"]
    }
  ]
}
```

Bridge 重启后 list_projects 应返回 available:true；false 表示目录不存在，不要自动创建旧路径。此时 create_agent_task 可给 project_id，不再反复输入 cwd。不注册也可直接给 cwd；这不是强制步骤。

## 常见问题

| 现象 | 先做什么 | 不要做什么 |
|---|---|---|
| 双击后没有界面 | 核对短路径完整包、WebView2 Runtime、诊断/fallback 错误 | 不只复制 EXE，不删除 AppData/.codex |
| Ready timeout / 数据目录无法创建 | 检查路径长度和可写性，使用短目录 | 不关闭所有 Edge/Codex，不盲清全部缓存 |
| Node / Codex 找不到 | 重新开终端，核对真实 exe 路径、官方安装 | 不下载陌生镜像，不大改 PATH |
| Codex lazy-ready | 可正常状态，首次需要它时启动 | 不把它误判为 disconnected |
| 模型不可用 | 核对账号是否支持当前 Luna/Max，保留错误 | 不擅自改为别的模型或放宽权限 |
| Tunnel 未配置/注册失败 | 核对自己的 ID、key、Platform/workspace 关联及 ready | 不填维护者 ID，不要求本机 curl internal gateway |
| ChatGPT 扫描失败或只见旧工具 | 确认进程/health/注册真实 ready，再 Refresh、新对话 | 不把“连接成功日期”当 tools/list PASS，不先删 App |
| thread/list/read 失败 | 保留日志与原始数据，先检查 app-server/分页读取层 | 不删 sessions、不重建整个 history |
| 工作目录空或不存在 | 选择自己已存在的项目目录 | 不把 Bridge artifacts 当你的项目 |
| Scheduled Tasks 数量不同 | 查当前实际本机只读来源 | 不假定全部云端任务都存于此 |
| 已经运行 | 从托盘恢复；核对 owned 实例 | 不 taskkill 所有 Node/Codex |
| 安全软件告警 | 核对下载来源、SHA、许可/provenance；有疑问先停止 | 不要求关闭防护或全目录信任 |

排错时可以分享版本、经过删敏的错误摘要、是否复现；不要默认发送原始日志、会话正文、完整诊断 JSON、用户路径、项目名或 key。

## 隐私、费用与授权

安装包不包含维护者私人数据。**使用时你主动授权读取的项目文本/线程内容可能经 MCP 返回 ChatGPT/OpenAI**，不能把“不公开到 GitHub”误解为“任何数据都不离开电脑”。先用不敏感项目测试，不选认证目录或密码库。详见 [隐私和发布边界](PRIVACY-RELEASE.zh-CN.md)。

Codex 登录、Tunnel runtime key、自定义 MCP 权限是不同东西。额度/费用由自己的账号及官方服务政策决定；Bridge 不承诺免费或无限，也不自动购买。登录/授权由本人完成。

Tunnel Runtime key 只通过配置向导的遮罩输入框设置，使用 Windows CurrentUser DPAPI 保存在本机；不要复制加密文件当通用凭据，也不要在项目文件或聊天中保存明文 key。

## 升级回滚与卸载

1. 真退出当前 Bridge；不要停止原生 Codex Desktop。
2. 保留旧完整包，并备份 Bridge 私有配置/状态；备份本身也不能公开上传。
3. 新 ZIP 解压到新短目录，先校验、测试完整启动/连接；不要重叠运行同一 Tunnel ID。
4. 需要切换唯一入口时，在新包目录明确运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-portable.ps1 -PackageDirectory . -UpdateDesktopShortcut
```

它会备份旧入口到 `%LOCALAPPDATA%\BridgeCodex\ShortcutBackups`，不生成重复快捷方式。默认安装冲突时不会擅自覆盖。

回滚：真退出新版本后，恢复旧包的准确快捷方式 Target/Start in。只按需要恢复兼容配置，不用旧 task store 覆盖新历史，不覆盖 `.codex`。不能声称旧版一定能读取未来格式，所以需保留状态备份并验证。

卸载：真退出后，只移除对应入口和自己确认的安装目录。默认保留 AppData、日志、配置、`.codex`、sessions/history 和原生 Codex；不提供清空数据的一键卸载。正在运行的包/回滚尚未验收时不要清理。

## 开发者与维护者

源码安装、构建、CI、第三方 runtime provenance 见 README、THIRD-PARTY、RELEASE-GATES。普通用户不需要跑 npm test 或编译 C#。包内 install.cmd 只是可核对的本地包装脚本，不从网上下载并执行未知安装代码。
