# Contributing / 贡献指南

Thank you for helping Team Rental Desk. Issues and pull requests are welcome in English or Simplified Chinese.

感谢你帮助改进 Team Rental Desk。Issue 和 Pull Request 可以使用英文或简体中文。

## Before opening an Issue / 提交 Issue 前

- Search existing Issues first.
- Use the bug or feature template.
- Remove real account names, customer records, email addresses, payment details, SMTP URLs, database files, screenshots containing private data, and local user paths.
- For a security problem, do not open a public Issue. Follow [`SECURITY.md`](./SECURITY.md).

- 请先搜索已有 Issue，并使用对应模板。
- 删除真实账号、客户资料、邮箱、收款内容、SMTP URL、数据库、含隐私的截图和本机用户路径。
- 安全漏洞不要公开提交，请按 [`SECURITY.md`](./SECURITY.md) 私密报告。

## Development setup / 开发环境

Use Windows 10/11 x64 and Node.js 24.

```powershell
npm run bootstrap
npm run typecheck
npm test
npm run build
```

Run `npm run package:win` only when an installer is needed. Generated `release/`, `out/`, databases, backups, logs, and local settings must never be committed.

## Pull requests / Pull Request 要求

You do not need to understand the whole project before contributing. Small fixes, suggestions, and partial improvements are welcome.

1. Briefly explain what you changed and why.
2. Do not include real accounts, customer data, passwords, databases, or other private information.
3. Take extra care with payments, renewals, and backups. Mention any possible effect on existing data and avoid deleting historical records.
4. Run the relevant tests when you can. If you cannot run them, simply say so in the PR.
5. Use fictional data such as `example.com` in screenshots and examples.

参与贡献前不需要先读懂整个项目；小修复、建议和未完成的改进也欢迎提交。

1. 简单说明改了什么、为什么改。
2. 不要提交真实账号、客户资料、密码、数据库或其他隐私内容。
3. 涉及收款、续费和备份时请格外注意，说明可能对现有数据造成的影响，并避免删除历史记录。
4. 有条件时请运行相关测试；暂时不会运行也没关系，在 PR 中说明即可。
5. 截图和示例请使用 `example.com` 等虚构数据。

Unless explicitly marked otherwise, intentionally submitted contributions are licensed under the Apache License 2.0 as described in Section 5 of that license.

除非提交者明确另行说明，主动提交并被合并的贡献按 Apache License 2.0 第 5 条处理。
