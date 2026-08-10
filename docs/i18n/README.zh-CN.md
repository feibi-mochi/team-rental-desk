# Team Rental Desk

<p align="center">
  <a href="../../README.md">English</a> ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="版本 1.0.0" src="https://img.shields.io/badge/version-1.0.0-5965d8">
  <img alt="Windows 10 和 11 x64" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4">
  <img alt="Apache License 2.0" src="https://img.shields.io/badge/code%20license-Apache--2.0-3b7a57">
</p>

Team Rental Desk 是一款本地优先的 Windows 桌面工具。它用于管理共享 ChatGPT / Codex 空间、出租子位置、收款、续费、成本、币种汇率、快捷方式、备份和提醒。软件会自动识别电脑中已经建立的 Chrome 独立用户；选择其中一个，即可自动生成固定使用该用户并打开指定 Team 管理页面的 Windows 快捷方式。该 Chrome 用户已经登录时，通常无需反复输入账号密码；本软件不会保存、读取或绕过平台密码。感谢 [Userchenentao5/team-account-manager](https://github.com/Userchenentao5/team-account-manager) 原作者的开源分享；Team Rental Desk 已在此基础上进行了实质性重构。

<p align="center">
  如果 Team Rental Desk 对你有帮助，欢迎点亮一个 ⭐ Star；感谢每一位使用、反馈和帮助它变得更好的人。
</p>

## 主要功能

- 自动识别标准 Chrome 中的独立用户并显示数量；选择一个用户、打开网址和可选关联空间后，自动生成对应的 Windows `.lnk`。该 Chrome 用户已经登录时，通常可以不再输入账号密码，直接进入对应账号或管理页面。
- 可选 Windows 开机检查、右下角系统通知和 SMTP 邮件提醒。
- 管理空间、母账号以及每个空间最多 2 个有效子位置。
- 区分出租和自用，记录客户更换、付款日、到期日、账期和部分收款。
- 收款支持无手续费、0.6% 和 1.6%，同时保留毛收入和实际净收入。
- 收款与续费保存当时的汇率快照，之后更新汇率不会改写历史。
- 展示月均应收、本月与累计实际收入、预计利润、到期状态、成本覆盖、月度收入和各空间表现。
- 每个空间最多绑定 4 个支付渠道，并可指定 1 个默认渠道。
- 支持新增、编辑、启停和安全删除币种；历史金额仍按原币种小数位显示。
- 支持归档、恢复和运营删除，不会悄悄清除历史收款或续费记录。
- 也可打开用户选择的 `.lnk`、`.exe`、`.url`、`.bat`、`.cmd` 等文件；解绑只删除软件内的关联，不会删除原文件。
- 支持立即备份、关闭时备份和间隔备份，每份 SQLite 备份都会先做完整性检查。
- 可选本机密码锁，密码输入框带显示/隐藏按钮。

### 搭配 Chrome 快捷方式按需跳转对应母号

1. 在 Chrome 中为不同的 ChatGPT / Codex 账号分别建立独立的[用户配置文件](https://support.google.com/chrome/answer/2364824?co=GENIE.Platform%3DDesktop&hl=zh-Hans)，并在每个配置文件里正常登录一次对应账号。
2. 进入 **Team 出租管理 → 快捷方式**。页面会自动读取标准 Google Chrome 中已经建立的独立用户，并显示识别数量。这里识别的是 Chrome 用户（个人资料），不是当前打开了多少个窗口或标签页。
3. 点击 **从 Chrome 自动创建**，选择对应的 Chrome 用户，填写快捷方式名称，并保留或修改打开网址。默认网址是 ChatGPT 工作区成员管理页面，也可以顺便关联到对应母空间。
4. 点击 **创建并保存**。软件会在当前 Windows 桌面的 `ChatGPT` 文件夹中生成 `.lnk`，同时加入快捷方式列表；如果已有同名文件，会自动追加数字，不会覆盖原文件。
5. 以后可从“快捷方式”页面直接打开；如果关联了母空间，当该空间出现在“运营概览”的待处理列表时，也能从那里快捷打开。已经有 `.lnk` 或需要绑定其他受支持文件时，可改用 **绑定已有文件**。
6. 只要所选 Chrome 用户中的登录状态仍然有效，通常无需再次输入账号密码，就会直接进入对应账号或管理页面。如果登录状态失效或平台要求验证，仍需在 Chrome 中正常登录。如果以后删除了这个 Chrome 用户，旧快捷方式不会改用默认用户；请回到本页重新识别并创建新的快捷方式。本软件只读取本机 Chrome 用户列表，不会读取或绕过密码、验证码、Cookie 及平台安全检查。

## 下载

请从 [GitHub Releases](https://github.com/wx2529496539-arch/team-rental-desk/releases/latest) 同时下载当前安装包和 `SHA256SUMS.txt`。

正式支持范围：

- Windows 10 / Windows 11 x64
- 安装包：`Team-Rental-Desk-1.0.0-Setup.exe`
- 按当前 Windows 用户安装，通常不需要管理员权限

安装包暂时没有数字签名，因此 Windows SmartScreen 可能提示“无法识别的应用”。请先核对 SHA-256；确认与同一 Release 里的 `SHA256SUMS.txt` 一致后，再选择“更多信息 → 仍要运行”。

```powershell
Get-FileHash .\Team-Rental-Desk-1.0.0-Setup.exe -Algorithm SHA256
```

### macOS 与 Linux

目前没有正式的 macOS、Linux、ARM64 或便携版。账务规则、SQLite 数据仓库、通用服务、React 界面和带类型的界面调用接口已经与桌面平台适配层分开；可工作的 Windows 实现集中在 `src/main/platform/windows`。社区移植者可以替换目标系统的路径、快捷方式、通知和开机任务适配器，不需要重写收款或历史记录逻辑。

#### 先在 macOS 或 Linux 上运行源码

1. 下载仓库的 Source code，安装 Node.js 24 和 npm。
2. 在源码目录运行：

   ```shell
   npm run bootstrap
   npm run dev
   ```

3. 这会使用独立的开发数据启动软件，适合先检查界面、账务和数据库功能；它不会生成安装包。尚未适配的 Chrome 快捷方式、开机启动和原生通知会明确显示为不可用。

#### 做成可分发的 macOS 或 Linux 安装包

1. 从现成模板开始实现目标系统适配器：macOS 修改 `src/main/platform/macos/macos-platform.ts`，Linux 修改 `src/main/platform/linux/linux-platform.ts`。
2. macOS 需要接入 Chrome 用户目录、固定用户的启动器、登录项和通知中心；Linux 需要接入 Chrome/Chromium 用户目录、`.desktop` 启动器、自动启动和桌面通知。
3. 在 `package.json` 增加对应的 Electron Builder 目标、图标和安装包名称；macOS 还要处理应用签名与公证，Linux 需要选择并验证 AppImage、deb 或 rpm 等格式，同时核对目标 CPU 架构的 SQLite 原生模块。
4. 运行 `npm run typecheck`、`npm run test:platform`、`npm test` 和 `npm run build`，再在真实目标系统测试首次安装、升级、备份恢复、提醒和数据库迁移。
5. 全部通过后，才能把生成的 macOS 或 Linux 安装包交给普通用户直接安装。只改打包参数而不完成这些适配，不能算移植完成。

可以把整个源码仓库交给 Codex 或其他编程 AI，并明确要求它按照 [PORTING.md](../PORTING.md) 完成目标平台适配、保留账务规则并执行全部验证。GitHub Actions 会在 Windows、macOS 和 Ubuntu 上检查通用代码，但在真实目标系统完成打包、迁移和数据完整性测试以前，只能标记为“社区适配”。服务器版还必须另外实现真正的登录 API、HTTPS、并发规则和服务器备份；本桌面版不会开放网络端口。

## 界面截图

| 运营概览 | 空间与子位置 |
| --- | --- |
| ![运营概览](../assets/screenshots/dashboard.png) | ![空间与子位置](../assets/screenshots/spaces.png) |

| 快捷方式 | 收款与续费流水 |
| --- | --- |
| ![快捷方式](../assets/screenshots/shortcuts.png) | ![收款与续费流水](../assets/screenshots/transactions.png) |

所有公开截图都来自独立的虚构演示数据库，画面里的账号和联系方式统一使用 `example.com`，不包含真实客户资料。

## 第一次使用

1. 安装后打开“Team 出租管理”。
2. 设置任意非空的本机登录密码。软件没有内置默认密码，也没有密码字符数量限制。
3. 按需添加支付渠道和币种。
4. 新增空间，再添加最多 2 个子位置。
5. 进入“设置 → 数据备份”，选择一个不在安装目录和正式数据目录里的备份位置。

> [!IMPORTANT]
> **软件密码只是本机界面锁。** 它不会加密 SQLite 数据库，也不能代替 Windows 账户密码、BitLocker 或系统权限；关闭“每次启动验证密码”只是取消登录界面。共用电脑时请特别注意。

## 数据与备份

正式数据库默认位于：

```text
%APPDATA%\team-rental-manager\data\team-rental.db
```

每份备份是普通本地文件夹，包含经过校验的 SQLite 副本、脱敏设置、检查结果和中文人工恢复说明。SMTP URL 会从备份副本中清除，恢复后需要重新填写。自动保留数量可设置为 3～100 份，程序只清理自己按规则生成的较旧备份目录。

建议定期手动备份，并在另一块磁盘保存一份重要备份。程序运行时不要直接编辑正式 SQLite 文件。

## 联网与隐私

Team Rental Desk 不启动 HTTP 服务、不监听局域网端口、不上传业务记录，也不收集分析数据。

只有下面两类功能可能联网：

- 软件打开期间会自动更新汇率。它先向 Coinbase 请求公开的 USD 参考汇率，缺失时再使用 Frankfurter。请求只包含需要查询的币种代码，不包含客户、账号、收款或数据库内容。
- 只有用户主动启用邮件提醒并填写 SMTP URL、发件人和收件人后，软件才会发送邮件。这些配置保存在本机数据库里，生成备份时会清除 SMTP 凭据。

Windows 通知完全在本机显示。关闭主窗口后，定时任务会停止，程序随即退出。

## 安全说明

- Electron 渲染进程启用沙箱和上下文隔离，并禁用 Node.js 访问。
- Preload 只暴露明确的业务接口，写入参数会校验。
- SQLite 启用外键、事务、完整性检查和不可变历史快照。
- 密码只保存带随机盐的 `scrypt` 哈希，不保存明文。
- 5 分钟内连续输错 5 次后，本机锁定 30 秒。
- 当前没有 MFA、远程账户、云同步或浏览器登录。

密码只是防止他人随手进入软件的本机界面锁，不会加密数据库，也不能替代 Windows 账户密码、BitLocker 或物理设备安全。发现漏洞请按 [SECURITY.md](../../SECURITY.md) 私密报告。

## 源码开发

通用源码检查需要 Node.js 24 和 npm。正式 NSIS 安装包仍需在 Windows 10/11 x64 上制作；社区贡献者可以在 macOS 或 Linux 上运行通用类型检查、测试和生产编译，但这本身不代表已经得到受支持的安装包。

```powershell
npm run bootstrap
npm run dev
npm run typecheck
npm run test:platform
npm test
npm run build
npm run package:win
```

`npm run bootstrap` 会先执行不运行第三方生命周期脚本的干净依赖安装，再明确安装已经审核的 Electron 运行时。`npm run dev` 始终使用独立的 `team-rental-manager-development` 配置和虚构演示数据，不会打开已安装软件的正式数据库。安装包输出到 `release/`。测试覆盖平台适配器、数据库迁移、收款、续费、归档恢复、备份、提醒、汇率回退、界面契约和仅开发环境可用的隔离截图模式。

更多内容见 [贡献指南](../../CONTRIBUTING.md)、[架构说明](../ARCHITECTURE.md) 和 [产品规格](../PRODUCT_SPEC.md)。

## 贡献与自愿支持

欢迎使用中文或英文提交 Issue 和 Pull Request。请勿在公开 Issue 中放入真实账号、客户资料、SMTP 凭据、数据库或本机用户路径。

如果 Team Rental Desk 帮到了你，欢迎点个 Star、分享使用反馈，或完全自愿地给予赞助。这些支持会帮助我了解真实使用需求，并决定后续维护与更新安排；项目由个人维护，不承诺固定更新频率。

<p align="center">
  <img alt="自愿支付宝支持收款码" src="../assets/support-alipay.jpg" width="300">
</p>

## 许可证

源码和普通文档采用 [Apache License 2.0](../../LICENSE)。应用图标等品牌素材另见 [ASSET-LICENSE.md](../../ASSET-LICENSE.md)，直接运行依赖见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。

详细法律与变更说明见 [NOTICE](../../NOTICE)。
