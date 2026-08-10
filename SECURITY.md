# Security policy / 安全策略

## Supported versions / 支持版本

Security fixes are provided for the latest public release line.

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| Pre-public local builds | No |

当前只为最新公开版本线提供安全修复；公开前的本机内部版本不再单独维护。

## Report a vulnerability privately / 私密报告漏洞

Please use GitHub's private vulnerability reporting page:

<https://github.com/wx2529496539-arch/team-rental-desk/security/advisories/new>

请使用上面的 GitHub 私密漏洞报告入口，不要在公开 Issue、Pull Request、Discussion 或截图中披露漏洞细节、真实数据库、密码、SMTP 凭据或客户资料。

Include, when possible:

- A concise description and affected version.
- Reproduction steps using fictional data.
- Expected impact and any known workaround.
- Relevant logs with secrets and local user paths removed.

建议提供：简要说明、受影响版本、使用虚构数据的复现步骤、可能影响、临时规避方法，以及已经删除凭据和本机路径的日志。

If private vulnerability reporting is temporarily unavailable, open a public Issue containing only “Private security contact requested / 请求私密安全联系”，without technical details. The maintainer will provide a private channel.

## Scope

Security reports may cover local password handling, Electron isolation, IPC authorization, database integrity, backup path safety, reminder credentials, installer behavior, and dependency vulnerabilities. Product suggestions and ordinary bugs should use the normal Issue templates.

Please remember that the in-app password is a local accidental-access barrier. It does not encrypt the SQLite database or replace Windows account security, BitLocker, or physical control of the computer.
