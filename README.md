# 本地邮箱管理系统

本地运行的 Outlook OAuth 邮箱管理系统，支持：

- 类似截图的账号管理页面
- 文本导入、文件上传、追加导入、覆盖导入
- `.txt` / `.xlsx` / `.xls` 批量导入
- `Client ID + Refresh Token` 批量同步收件箱邮件
- TXT 备份导出
- SQLite 本地保存账号和最近同步的邮件元数据
- 批量同步默认按单账号分批执行，批次间自动等待并在限流时重试

## 启动

```bash
npm install
npm start
```

打开 `http://localhost:3060`

## AI 接手

- 入口文件： [agent.md](/D:/workspace/code/mail/agent.md)
- 当前状态： [PROJECT_STATE.md](/D:/workspace/code/mail/PROJECT_STATE.md)
- 稳定结构： [ARCHITECTURE.md](/D:/workspace/code/mail/ARCHITECTURE.md)

建议新的 AI 会话：

- 开始时使用 `$project-startup`
- 结束前使用 `$project-shutdown`

## 测试

```bash
npm test
```

- 自动化测试覆盖导入解析、导入导出接口、同步成功/失败链路、批量节流重试、OAuth token 刷新逻辑
- 覆盖率阈值已启用：`lines >= 80`、`statements >= 80`、`functions >= 75`、`branches >= 60`
- 无法稳定自动化的浏览器交互与真实活令牌验证，按 [docs/manual-test-checklist.md](/D:/workspace/code/mail/docs/manual-test-checklist.md) 执行人工测试
- 2026-03-26 已使用本地 `test_mail.txt` 中 5 个一次性 Outlook 测试账号完成真实批量同步回归，结果为 5/5 成功

## 文本导入格式

每行一个账号，支持两种格式：

```text
email[TAB]password[TAB]client_id[TAB]refresh_token
email----password----client_id----refresh_token
```

可选：

- 第 5 列：过期时间
- 第 6 列：分组

## Excel 导入格式

- 第 1 列：邮箱
- 第 2 列：密码
- 第 3 列：Client ID
- 第 4 列：刷新令牌
- 第 5 列：过期时间
- 第 6 列：分组

## 说明

- 当前 Outlook OAuth 同步走 Outlook 邮件 REST 接口读取收件箱。
- “同步”指刷新令牌并读取收件箱最近邮件元数据，再保存到本地 SQLite；不是网页登录邮箱。
- 默认同步策略为串行单批次、批次间等待 4 秒、限流或瞬时网络错误最多重试 3 次，所以批量同步会比并发请求更慢，但更稳。
- 之前出现过的同步失败主要是 Microsoft 返回 `AADSTS90055`，表示请求过快触发限流，不是账号格式错误或页面登录失败。
- 数据模型里仍保留了 IMAP 字段，主要为了兼容后续扩展和历史结构。
- 本地数据库文件在 `data/mail.db`。
- 账号密码、刷新令牌会保存在本地数据库；如果长期使用，建议后续补本地加密存储。
