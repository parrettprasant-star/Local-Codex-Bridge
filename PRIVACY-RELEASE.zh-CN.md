# 隐私与公开发布边界

适用 6.2.0。公开发布仍需维护者单独授权；本地测试 PASS 不表示已经上传或已发布。

## 允许准备公开的范围

只使用明确白名单的源码快照、完整 Windows 干净运行包和 SHA256SUMS。source ZIP 内的 SOURCE-MANIFEST、Windows ZIP 内的 PACKAGE-MANIFEST 逐文件列出内容；不从个人电脑根目录或 live AppData 打包。

公开说明中的路径是通用示例，不使用维护者 Windows 用户名、项目注册、业务会话标题、真实 Tunnel ID、实际 token/key。第三方公开 license/NOTICE 的作者和联系信息属于许可署名，不能为了脱敏破坏合法归属。

## 永不随包上传

- `.codex`、auth/config、sessions/history、JSONL、SQLite、原生线程缓存。
- Bridge AppData、DPAPI、Runtime API Key、真实 Tunnel ID/profile、projects.json。
- task store、运行日志、原始诊断 JSON、浏览器/WebView2 cache。
- 私人截图、聊天附件、桌面维护文档、回滚备份、用户目录。
- 本机 `.git` 历史、未审查 dirty files、node_modules 和 staging/test 输出。

忽略规则不是全部保护：仍要核对实际 ZIP 内容、JSON/文本、UTF-8/UTF-16 二进制字符串、凭据模式和精确 staged diff。扫描只能提供证据，不能保证不存在任何未知敏感字段。

## 安装和运行时

安装脚本只在本机验证包/设置准确桌面入口，不公开上传。用户自行输入的 Runtime key 用当前 Windows 用户 DPAPI 保存，不能复制到另一台机器作为通用设置；不要贴进 ChatGPT 或 issue。

**实际使用 MCP 时，用户主动请求的本地项目/线程内容可能发给 ChatGPT/OpenAI。** 不把“不上传 GitHub”说成“所有数据永远只在本机”。插件 thread 查询的 cwd/search 是过滤，不是完整访问控制；Bridge 不是对恶意同用户进程的隔离沙箱。不要授权访问密码库、认证目录或不愿分享的文件。

## 出错时怎样反馈

优先提供版本、可复现步骤、删敏的错误摘要、是否影响启动/连接。不默认上传完整日志、原始 JSON、全部截图或会话正文。分享前遮住 key/token、Tunnel ID、用户名、项目名、完整路径和账号信息；密钥泄露应通过官方账号入口撤销/轮换，而不是只删除截图。

## 发布前最终闸门

1. 锁定唯一白名单和最终 ZIP/内层 manifest SHA。
2. 再次扫描私人身份标记/运行数据/凭据，人工复核误报和公开许可署名。
3. 只在确切账号/仓库授权后提交公开快照，不直接提交私人开发树。
4. 实际 hosted CI PASS 后发布；下载附件重新核对，不以本地构建冒充公网上线。

每位用户需自己的 Tunnel。社区构建未签名，不关闭防护、不伪称官方发行。详见 SECURITY.md / TUNNEL-SETUP.md / RELEASE-GATES.md。
