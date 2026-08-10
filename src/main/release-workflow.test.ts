import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const notificationState = { shown: 0 };
const fakePlatform = {
  setStartupCheckEnabled: () => undefined,
  showNotification: () => {
    notificationState.shown += 1;
    return true;
  },
};

import { BackupService } from "./backup/backup-service.js";
import { TeamRentalDatabase } from "./database/database.js";
import { TeamRentalRepository } from "./database/repository.js";
import { localDateNow } from "./domain/calendar.js";
import { ReminderService } from "./reminders/reminder-service.js";
import { ChromeShortcutService } from "./platform/windows/chrome-shortcut-service.js";

const temporaryDirectories: string[] = [];
const databases: TeamRentalDatabase[] = [];

afterEach(() => {
  notificationState.shown = 0;
  for (const database of databases.splice(0)) if (database.db.open) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("v1.0.0 code-driven human workflow", () => {
  it("covers daily setup, billing, renewal, archive recovery, currency removal, backup, and reminders", async () => {
    const root = mkdtempSync(join(tmpdir(), "team-rental-release-workflow-"));
    temporaryDirectories.push(root);
    const dataDirectory = join(root, "data");
    const database = new TeamRentalDatabase(join(dataDirectory, "app.db"));
    databases.push(database);
    const repository = new TeamRentalRepository(database);
    const today = localDateNow();
    const currentCycleStartedOn = localDateNow(new Date(Date.now() - 24 * 60 * 60 * 1_000));
    const anchorDay = Number(today.slice(8, 10));

    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('CNY', '7.2', 'release-workflow', ?)
    `).run(new Date().toISOString());

    const sourceSpaceId = repository.saveSpace({
      displayName: "示例来源空间",
      serviceKind: "chatgpt",
      ownerLogin: "source-owner@example.com",
      countryCode: "CN",
      sourceCurrency: "CNY",
      sourceCostMinor: 18_000,
      openedOn: "2020-01-01",
      currentCycleStartedOn,
      renewsOn: today,
      renewalAnchorDay: anchorDay,
      cycleMonths: 1,
      motherSeatKind: "chatgpt",
      motherSeatFlexible: false,
      paymentMethodIds: [],
      defaultPaymentMethodId: null,
    });
    const targetSpaceId = repository.saveSpace({
      displayName: "示例目标空间",
      serviceKind: "codex",
      ownerLogin: "target-owner@example.com",
      countryCode: "CN",
      sourceCurrency: "CNY",
      sourceCostMinor: 16_000,
      openedOn: "2020-01-01",
      currentCycleStartedOn,
      renewsOn: today,
      renewalAnchorDay: anchorDay,
      cycleMonths: 1,
      motherSeatKind: "codex",
      motherSeatFlexible: false,
      paymentMethodIds: [],
      defaultPaymentMethodId: null,
    });

    const chromeUserData = join(root, "Chrome", "User Data");
    const generatedShortcuts = join(root, "Desktop", "ChatGPT");
    const chromeExecutable = join(root, "Chrome", "Application", "chrome.exe");
    mkdirSync(chromeUserData, { recursive: true });
    mkdirSync(join(chromeUserData, "Default"));
    mkdirSync(join(chromeUserData, "Profile 1"));
    mkdirSync(join(root, "Chrome", "Application"), { recursive: true });
    writeFileSync(chromeExecutable, "test chrome", "utf8");
    writeFileSync(
      join(chromeUserData, "Local State"),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: "本人", user_name: "owner@example.com" },
            "Profile 1": {
              name: "示例来源空间",
              user_name: "source-owner@example.com",
            },
          },
        },
      }),
      "utf8",
    );
    const chromeShortcuts = new ChromeShortcutService(
      {
        shortcutsDirectory: generatedShortcuts,
        chromeUserDataDirectory: chromeUserData,
        chromeExecutable,
      },
      (path) => {
        writeFileSync(path, "test shortcut", "utf8");
        return true;
      },
    );
    expect(chromeShortcuts.listProfiles()).toHaveLength(2);
    const generatedShortcut = chromeShortcuts.create({
      label: "示例来源空间",
      profileDirectory: "Profile 1",
      url: "https://chatgpt.com/admin/members",
      spaceId: sourceSpaceId,
    });
    repository.saveShortcut({
      label: "示例来源空间",
      targetPath: generatedShortcut,
      spaceId: sourceSpaceId,
    });
    expect(repository.listShortcuts()).toContainEqual(
      expect.objectContaining({
        label: "示例来源空间",
        targetPath: generatedShortcut,
        spaceId: sourceSpaceId,
        available: true,
      }),
    );

    const childSeatId = repository.saveChildSeat({
      spaceId: sourceSpaceId,
      positionNumber: 1,
      seatKind: "chatgpt",
      usageKind: "rental",
      customerLogin: "customer@example.com",
      label: "公开演示客户",
      contact: "support@example.com",
      joinedOn: currentCycleStartedOn,
      chargeCurrency: "CNY",
      chargeMinor: 10_000,
      paymentDay: anchorDay,
      nextPaymentOn: today,
      cycleMonths: 1,
    });
    repository.recordReceipt({
      operationId: "00000000-0000-4000-8000-000000000101",
      childSeatId,
      grossMinor: 10_000,
      feeBasisPoints: 60,
      receivedAt: new Date().toISOString(),
    });
    repository.renewSpace({
      operationId: "00000000-0000-4000-8000-000000000102",
      spaceId: sourceSpaceId,
      frozenUsdMinor: 2_500,
      paidAt: new Date().toISOString(),
    });

    repository.archiveChildSeat(childSeatId);
    expect(repository.listArchivedChildSeats(today).map((seat) => seat.id)).toContain(childSeatId);
    repository.restoreChildSeat({ childSeatId, targetSpaceId, positionNumber: 1 });
    expect(repository.listSpaces(today).find((space) => space.id === targetSpaceId)?.childSeats[0]?.id)
      .toBe(childSeatId);

    const history = repository.listTransactions();
    expect(history.receipts).toHaveLength(1);
    expect(history.renewals).toHaveLength(1);
    expect(history.receipts[0]).toMatchObject({
      spaceId: sourceSpaceId,
      spaceName: "示例来源空间",
      childSeatId,
      canVoid: false,
    });

    repository.saveCurrency({ code: "JPY", name: "日元", symbol: "¥", decimalPlaces: 0, enabled: true });
    repository.deleteCurrency("JPY");
    expect(repository.listCurrencies().some((currency) => currency.code === "JPY")).toBe(false);
    expect(repository.listCurrencies(true)).toContainEqual(expect.objectContaining({
      code: "JPY",
      decimalPlaces: 0,
      enabled: false,
    }));

    const disabledGroup = {
      enabled: false,
      scheduledEnabled: false,
      startupCheckEnabled: false,
      repeatSameDayEnabled: true,
      recipientEmail: "",
      sendTime: "08:00",
      thresholdDays: 90,
      smtpUrl: "",
      smtpFrom: "",
      templateSubject: "{{count}} 个提醒",
      templateBody: "请处理",
    };
    const reminders = new ReminderService(database, repository, fakePlatform);
    reminders.saveSettings({
      loginStartupCheckEnabled: false,
      windowsNotificationEnabled: true,
      space: disabledGroup,
      child: disabledGroup,
    });
    const reminderResult = await reminders.run("startup");
    expect(reminderResult.spaces).toBeGreaterThan(0);
    expect(reminderResult.children).toBeGreaterThan(0);
    expect(reminderResult).toMatchObject({ emailsSent: 0, windowsNotifications: 1 });
    expect(notificationState.shown).toBe(1);

    const backupDirectory = join(root, "backups");
    const backup = new BackupService(
      database,
      backupDirectory,
      join(root, "application"),
      dataDirectory,
    );
    backup.saveSettings({
      directory: backupDirectory,
      onClose: true,
      intervalEnabled: true,
      intervalMinutes: 60,
      retentionCount: 30,
    });
    const backupResult = await backup.run("manual");
    expect(backupResult).toMatchObject({ integrity: "ok", foreignKeyErrors: 0 });
    const backupDatabasePath = join(backupResult.directory, "team-rental.db");
    expect(existsSync(backupDatabasePath)).toBe(true);
    const backupDatabase = new Database(backupDatabasePath, { readonly: true });
    expect(backupDatabase.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(backupDatabase.pragma("foreign_key_check")).toEqual([]);
    expect((backupDatabase.prepare("SELECT COUNT(*) AS count FROM receipt").get() as { count: number }).count).toBe(1);
    expect((backupDatabase.prepare("SELECT COUNT(*) AS count FROM renewal_event").get() as { count: number }).count).toBe(1);
    backupDatabase.close();
  });
});
