# Community porting guide / 社区移植指南

Team Rental Desk officially ships only a Windows 10/11 x64 installer. The source is arranged so a community porter can keep the accounting engine and replace the operating-system shell. macOS, Linux, ARM64, headless, and server builds are not official releases until they pass the validation checklist below.

Team Rental Desk 目前只正式发布 Windows 10/11 x64 安装包。源码已经按“保留账务核心、替换系统外壳”的方式划分，方便社区移植者适配 macOS、Linux、ARM64 或后台运行方式；这些版本通过下方全部验证以前，不能标记为正式支持。

## The boundary to keep / 不需要重写的部分

Keep these modules unchanged whenever possible:

- `src/main/domain/`: dates, money, conversion, and validation rules.
- `src/main/database/`: SQLite schema, migrations, repository, immutable billing history, and archive/restore rules.
- `src/main/backup/`, `rates/`, and the non-OS parts of `reminders/`.
- `src/renderer/`: the React UI.
- `src/shared/contracts.ts`: `TeamRentalApi`, all inputs and outputs, and platform capability flags.

尽量不要改动这些目录中的账务规则。平台移植不应重新实现收款、续费、历史快照、归档或数据库迁移。

## Replaceable platform shell / 可替换的系统外壳

The stable adapter is `src/main/platform/contracts.ts`:

```ts
interface DesktopPlatform {
  readonly id: NodeJS.Platform;
  readonly capabilities: PlatformCapabilities;
  readonly chromeShortcuts: ChromeShortcutProvider;
  setStartupCheckEnabled(enabled: boolean): void;
  showNotification(input: NativeNotificationInput): boolean;
}
```

- `src/main/platform/windows/` contains the working Windows implementation, including `.lnk` creation and standard Chrome profile discovery.
- `src/main/platform/community-platform.ts` is a safe template. It returns unsupported capabilities instead of pretending that files or OS integrations were created.
- `src/main/platform/create-platform.ts` is the only platform selector.
- `ReminderService` depends on `DesktopPlatform`; it no longer imports Electron notification or startup APIs directly.
- `registerIpc` depends on `ChromeShortcutProvider`, not on a Windows class.

移植者应新增目标平台适配器并接入 `create-platform.ts`，而不是在账务服务中到处增加 `if (process.platform === ...)`。

## macOS desktop port / macOS 桌面移植

1. Replace the safe community template in `src/main/platform/macos/macos-platform.ts` with a real `DesktopPlatform` implementation.
2. Locate Chrome profiles under the current macOS user Library and validate every profile directory before presenting it.
3. Replace `.lnk` output with a profile-pinned launcher appropriate for macOS. It must never fall back silently to another Chrome profile.
4. Implement login-item registration and Notification Center behavior.
5. Add Electron Builder macOS targets, icons, universal/architecture choices, signing, and notarization.
6. Rebuild or use the bundled `better-sqlite3` binary for the real target architecture.
7. Run tests and migration checks on a real Mac. A Windows-generated artifact is not sufficient validation.

## Linux desktop port / Linux 桌面移植

1. Replace the safe community template in `src/main/platform/linux/linux-platform.ts` with a real `DesktopPlatform` implementation.
2. Support the Chrome/Chromium profile locations chosen by the distribution and validate profile directories.
3. Generate a safe `.desktop` launcher with correctly escaped profile and URL arguments.
4. Implement autostart and desktop notifications for the supported desktop environment, or report the capability as unavailable.
5. Add Electron Builder Linux targets and test permissions, icons, case-sensitive paths, removable drives, and upgrade behavior on the target distribution.

## Headless jobs and server editions / 后台任务与服务器版

The repository, rate service, backup service, and reminder decision logic can be reused by a headless process. A porter may create a separate entry point that opens a configured database and invokes one explicit task such as rates, reminders, or backup.

Do **not** turn the Electron IPC bridge into a public port. A remote server edition must separately implement:

- an authenticated transport implementing the existing `TeamRentalApi` contract;
- HTTPS, session protection, authorization, input limits, and audit logging;
- concurrency rules for SQLite or a deliberate database replacement;
- server-side backup, restore, process supervision, and secret management.

当前项目不会因为预留移植接口而监听 HTTP 或局域网端口。服务器版可以让网页传输层实现同一个 `TeamRentalApi`，从而复用 React 界面，但不能直接把 IPC 或 SQLite 暴露到公网。

## Capability-driven UI / 按能力调整界面

`app:bootstrap` returns `platformCapabilities`:

- `chromeProfileShortcuts`
- `nativeNotifications`
- `startupCheck`

A completed port should use these values to hide or replace unsupported controls. Do not leave a button that reports success while doing nothing.

## Checks available to porters / 可直接使用的检查

```shell
npm run bootstrap
npm run typecheck
npm run test:platform
npm test
npm run build
```

GitHub Actions runs type checking, the complete test suite, and a production build on Windows, macOS, and Ubuntu. This checks that portable code has not accidentally gained a Windows-only import; it does not turn untested packages into official releases.

## Required validation before calling a port supported / 正式支持前必须验证

1. Build on the real target OS and architecture from a clean checkout.
2. Run type checking, the complete test suite, and a production build.
3. Test first install, upgrade, uninstall-with-data-retained, and reinstall.
4. Migrate a sanitized copy of an existing database and compare every business table before and after.
5. Verify `PRAGMA integrity_check` returns `ok` and `PRAGMA foreign_key_check` returns no rows.
6. Exercise spaces, payments, renewals, archive/restore, currency deletion, backups, notifications, reminders, and shortcuts with code-driven tests.
7. Verify target-specific paths, permissions, startup behavior, high-DPI layout, fonts, and native modules on real hardware.
8. Document limitations and provide signing/notarization where the target platform expects it.

Never test a community port against the only copy of a real database. Use an SQLite online backup, keep the original untouched, and compare table counts and deterministic row hashes after migration.

社区移植不得直接拿唯一一份真实数据库试运行。应先制作 SQLite 安全副本，保留原文件不动，再核对业务表数量、逐行哈希、完整性和外键。Codex 或其他 AI 可以协助实现，但不能代替目标平台负责人、真实设备测试、代码签名和迁移验证。
