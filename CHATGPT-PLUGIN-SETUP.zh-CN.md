# 在 ChatGPT 网页添加 Bridge 插件（Windows / Mac）

**先在本机配置，再添加插件。** 未连接的插件不能安装本机。Windows 看 [小白安装](START-HERE.zh-CN.md)，Mac 看 [浏览器版预览](MACOS.zh-CN.md)。GitHub 公开下载不等于所有账号自动拥有自定义 MCP/Tunnel 权限。

依据：[官方连接流程](https://developers.openai.com/plugins/deploy/connect-chatgpt)、[官方 Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。界面随账号/版本变化；入口不存在先检查组织权限，不清历史/重装 App 来猜。

## 添加步骤

1. 本机启动 Bridge，保持运行。Windows 从桌面快捷方式；Mac 运行 `node scripts/macos-bridge.mjs start`。
2. 本机诊断确认注册/transport 真实 Ready。Codex 可健康 lazy-ready，不必先创建任务。
3. ChatGPT 网页 → 插件/Apps → **添加 → 添加自定义 MCP 服务器**。不是“上传插件压缩包”，不上传 Windows ZIP/源码。
4. 名称填 `Local Codex Bridge`，说明可写“连接我自己电脑的 Codex Agent”。
5. 连接类型 **Tunnel**，填和本机配置**完全一致的本人 Tunnel ID**。不复制截图示例，不把本机 `127.0.0.1` URL 当成 Cloud endpoint。
6. 本项目私人 stdio MCP 认证选 **No authentication**。这是服务器没有单独 OAuth，不代表控制面不用本人权限/key。**key 仅配置在本机，不能粘到 ChatGPT 表单或聊天。**
7. 阅读访问提示，确认自己的服务后创建/创建为插件，再安装/连接；首次授权由本人确认。
8. 新对话用 `@Local Codex Bridge` 或工具菜单选插件。更新的连接日期不是实际调用成功证据。

[已有脱敏图解](https://github.com/parrettprasant-star/Local-Codex-Bridge/blob/main/SCREENSHOT-GUIDE.zh-CN.md)展示网页按钮、授权和 Bridge；Windows 演示图不是 Mac 截图，历史真实调用不是本次新 Cloud 测试。

## 第一次：只发现能力，不创建任务

```text
请实际调用当前 Local Codex Bridge 的 get_agent_list，然后调用 get_capabilities（agent_id=codex_local）。报告是否真实发出、返回状态、Agent 数量和能力名称。没工具、Bridge 未运行、Tunnel 未就绪或连接失败时说明准确层级，不把文字分析当作调用成功。不要创建/续写任何 task/thread，不读项目/会话内容、不写文件、不改配置、不删除或重建 App。
```

完整目录应有 13 个工具：

```text
codex_threads, codex_turn, codex_observe, codex_steer,
codex_respond, codex_interrupt, codex_checkpoint,
create_agent_task, get_task_status, list_projects,
get_project, get_agent_list, get_capabilities
```

本地 catalog=13 不能证明这次 Cloud 已调用。`BLOCKED_BEFORE_CALL` 表示未发出，不是 Agent 执行失败。

## 下一步：自己项目中的第一个任务

```text
先实际 list_projects，给我看可用 project_id，不读文件内容。等我选择后，create_agent_task：只回复 BRIDGE_FIRST_OK，不执行命令、不修改文件，使用我选定的 project_id。拿到 task_id 后 get_task_status 观察同一任务，不重复创建。completed 后报告摘要和实际输出文件数；需确认/失败时停下说明。
```

未注册项目时先在本机配置真实目录，不能让 ChatGPT 猜 cwd。日常：启动本机 Bridge → 网页选插件 → 实际调用 → Bridge 看进度结果 → 真退出。电脑关机/终端关闭后无法连接是正常情况。

## 分层排错

| 层级 | 检查 |
|---|---|
| 入口没有 | ChatGPT/工作区权限，不是软件可绕过的限制 |
| 注册失败 | 本人 Platform 权限/key、Tunnel ID、真实 parent/child 和网络 |
| 只有旧工具/无工具 | 同一 Tunnel 绑定、新对话是否选插件、initialize/tools-list 是否实际到达 |
| Session terminated | transport/owned child 是否实际存活，不相信旧 state Ready |
| 发现但任务被拒 | 项目路径、模型权限、sandbox/approval，不修改原生数据 |
| 会话列表空 | 单独诊断 Native 读取层；Scheduled Tasks 独立，不重建 sessions |

维护者不需要你的密码、验证码、Passkey/API key。Issue只提交脱敏版本、系统/芯片、失败层级和时间，不能贴原始会话、注册/key、私人截图。
