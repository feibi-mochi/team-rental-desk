import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const notificationState = { shown: 0 };

import { TeamRentalDatabase } from "../database/database.js";
import { TeamRentalRepository } from "../database/repository.js";
import { localDateNow } from "../domain/calendar.js";
import { ReminderService } from "./reminder-service.js";

const directories: string[] = [];
const databases: TeamRentalDatabase[] = [];
const fakePlatform = () => ({
  setStartupCheckEnabled: vi.fn(),
  showNotification: vi.fn(() => {
    notificationState.shown += 1;
    return true;
  }),
});
afterEach(() => {
  vi.restoreAllMocks();
  notificationState.shown = 0;
  for (const database of databases.splice(0)) if (database.db.open) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ReminderService scheduled delivery", () => {
  it("does not resend a successful group when another group fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-reminder-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    databases.push(database);
    const repository = new TeamRentalRepository(database);
    const today = localDateNow();
    const spaceId = repository.saveSpace({
      displayName: "到期空间", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "CN",
      sourceCurrency: "USD", sourceCostMinor: 2_500, openedOn: "2026-01-01", currentCycleStartedOn: "2026-07-01",
      renewsOn: today, renewalAnchorDay: 1, cycleMonths: 1, motherSeatKind: "chatgpt", motherSeatFlexible: false,
      paymentMethodIds: [], defaultPaymentMethodId: null,
    });
    repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental", customerLogin: "child@example.com",
      label: "", contact: "", joinedOn: "2026-01-01", chargeCurrency: "USD", chargeMinor: 1_000,
      paymentDay: 1, nextPaymentOn: "2026-09-01", cycleMonths: 1,
    });
    const service = new ReminderService(database, repository, fakePlatform());
    const group = {
      enabled: true, scheduledEnabled: true, startupCheckEnabled: false, repeatSameDayEnabled: true,
      recipientEmail: "to@example.com", sendTime: "00:00", thresholdDays: 90,
      smtpUrl: "smtps://user:password@example.com:465", smtpFrom: "from@example.com",
      templateSubject: "{{count}} 个提醒", templateBody: "请处理",
    };
    service.saveSettings({ loginStartupCheckEnabled: false, windowsNotificationEnabled: true, space: group, child: group });
    const sentSubjects: string[] = [];
    (service as unknown as { send: (_group: unknown, subject: string) => Promise<void> }).send = vi.fn(async (_group, subject) => {
      sentSubjects.push(subject);
      if (sentSubjects.length === 2) throw new Error("child failed");
    });

    await expect(service.runScheduledIfDue()).rejects.toThrow("child failed");
    expect(database.getSetting("reminder.scheduled.space.lastRunDate")).toBe(today);
    expect(database.getSetting("reminder.scheduled.child.lastRunDate")).toBeNull();

    (service as unknown as { send: (_group: unknown, subject: string) => Promise<void> }).send = vi.fn(async (_group, subject) => { sentSubjects.push(subject); });
    await service.runScheduledIfDue();
    expect(sentSubjects).toHaveLength(3);
    expect(database.getSetting("reminder.scheduled.child.lastRunDate")).toBe(today);
  });

  it("sends a newly due item created after the day's first scheduled check", async () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-reminder-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    databases.push(database);
    const repository = new TeamRentalRepository(database);
    const today = localDateNow();
    const service = new ReminderService(database, repository, fakePlatform());
    const group = {
      enabled: true,
      scheduledEnabled: true,
      startupCheckEnabled: false,
      repeatSameDayEnabled: false,
      recipientEmail: "to@example.com",
      sendTime: "00:00",
      thresholdDays: 90,
      smtpUrl: "smtps://user:password@example.com:465",
      smtpFrom: "from@example.com",
      templateSubject: "{{count}} 个提醒",
      templateBody: "请处理",
    };
    service.saveSettings({
      loginStartupCheckEnabled: false,
      windowsNotificationEnabled: false,
      space: group,
      child: group,
    });
    const sentSubjects: string[] = [];
    (service as unknown as {
      send: (_group: unknown, subject: string) => Promise<void>;
    }).send = vi.fn(async (_group, subject) => {
      sentSubjects.push(subject);
    });

    await service.runScheduledIfDue();
    expect(sentSubjects).toEqual([]);

    const spaceId = repository.saveSpace({
      displayName: "稍晚新增的到期空间",
      serviceKind: "chatgpt",
      ownerLogin: "late@example.com",
      countryCode: "CN",
      sourceCurrency: "USD",
      sourceCostMinor: 2_500,
      openedOn: "2026-01-01",
      currentCycleStartedOn: "2026-07-01",
      renewsOn: today,
      renewalAnchorDay: 1,
      cycleMonths: 1,
      motherSeatKind: "chatgpt",
      motherSeatFlexible: false,
      paymentMethodIds: [],
      defaultPaymentMethodId: null,
    });

    const result = await service.runScheduledIfDue();
    expect(result).toMatchObject({ spaces: 1, emailsSent: 1 });
    expect(sentSubjects).toEqual(["1 个提醒"]);
    expect(
      database.getSetting("reminder.scheduled.space.lastDueSignature"),
    ).toBe(spaceId);

    await expect(service.runScheduledIfDue()).resolves.toBeNull();
    expect(sentSubjects).toHaveLength(1);
  });

  it("formats zero-decimal currencies with their configured precision", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-reminder-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    databases.push(database);
    const repository = new TeamRentalRepository(database);
    repository.saveCurrency({ code: "JPY", name: "日元", symbol: "¥", decimalPlaces: 0, enabled: true });
    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('JPY', '150', 'test', '2026-08-09T00:00:00.000Z')
    `).run();
    repository.saveSpace({
      displayName: "日元空间", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "JP",
      sourceCurrency: "JPY", sourceCostMinor: 5_000, openedOn: "2026-08-01", currentCycleStartedOn: "2026-08-01",
      renewsOn: "2026-09-01", renewalAnchorDay: 1, cycleMonths: 1, motherSeatKind: "chatgpt", motherSeatFlexible: false,
      paymentMethodIds: [], defaultPaymentMethodId: null,
    });
    const service = new ReminderService(database, repository, fakePlatform());
    const html = (service as unknown as {
      spaceHtml: (spaces: ReturnType<TeamRentalRepository["listSpaces"]>, group: ReturnType<ReminderService["getSettings"]>["space"]) => string;
    }).spaceHtml(repository.listSpaces("2026-08-09"), service.getSettings().space);
    expect(html).toContain("5,000");
    expect(html).not.toContain("50.00");
  });

  it("shows a USDT reference only when an enabled, non-deleted quote exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-reminder-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    databases.push(database);
    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('CNY', '7.2', 'test', '2026-08-09T00:00:00.000Z')
    `).run();
    const repository = new TeamRentalRepository(database);
    const spaceId = repository.saveSpace({
      displayName: "稳定币参考测试", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "CN",
      sourceCurrency: "USD", sourceCostMinor: 2_500, openedOn: "2026-08-01", currentCycleStartedOn: "2026-08-01",
      renewsOn: "2026-09-01", renewalAnchorDay: 1, cycleMonths: 1, motherSeatKind: "chatgpt", motherSeatFlexible: false,
      paymentMethodIds: [], defaultPaymentMethodId: null,
    });
    repository.renewSpace({ spaceId, frozenUsdMinor: 2_500, paidAt: "2026-08-09T01:00:00.000Z" });
    const service = new ReminderService(database, repository, fakePlatform());
    const render = () => (service as unknown as {
      spaceHtml: (spaces: ReturnType<TeamRentalRepository["listSpaces"]>, group: ReturnType<ReminderService["getSettings"]>["space"]) => string;
    }).spaceHtml(repository.listSpaces("2026-08-09"), service.getSettings().space);

    expect(render()).not.toContain("USDT");

    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('USDT', '1.002', 'test', '2026-08-09T00:00:00.000Z')
    `).run();
    expect(render()).toContain("25.05 USDT");

    database.db.prepare("UPDATE money_unit SET enabled = 0, deleted_at = ? WHERE code = 'USDT'")
      .run("2026-08-09T02:00:00.000Z");
    expect(render()).not.toContain("USDT");
  });

  it("does not remind for archived or soft-deleted spaces and child seats", async () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-reminder-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    databases.push(database);
    const repository = new TeamRentalRepository(database);
    const today = localDateNow();
    const saveSpace = (displayName: string, renewsOn: string) => repository.saveSpace({
      displayName, serviceKind: "chatgpt", ownerLogin: `${displayName}@example.com`, countryCode: "CN",
      sourceCurrency: "USD", sourceCostMinor: 2_500, openedOn: "2026-01-01", currentCycleStartedOn: "2026-07-01",
      renewsOn, renewalAnchorDay: 1, cycleMonths: 1, motherSeatKind: "chatgpt", motherSeatFlexible: false,
      paymentMethodIds: [], defaultPaymentMethodId: null,
    });

    const deletedSpaceId = saveSpace("已删除到期空间", today);
    repository.archiveSpace(deletedSpaceId);
    repository.deleteArchivedSpace(deletedSpaceId);

    const activeSpaceId = saveSpace("仅保留母空间", "2099-09-01");
    const deletedChildId = repository.saveChildSeat({
      spaceId: activeSpaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "deleted-child@example.com", label: "", contact: "", joinedOn: "2026-01-01",
      chargeCurrency: "USD", chargeMinor: 1_000, paymentDay: 1, nextPaymentOn: today, cycleMonths: 1,
    });
    repository.archiveChildSeat(deletedChildId);
    repository.deleteArchivedChildSeat(deletedChildId);

    const service = new ReminderService(database, repository, fakePlatform());
    const disabledGroup = {
      enabled: false, scheduledEnabled: false, startupCheckEnabled: false, repeatSameDayEnabled: true,
      recipientEmail: "", sendTime: "08:00", thresholdDays: 5, smtpUrl: "", smtpFrom: "",
      templateSubject: "{{count}} 个提醒", templateBody: "请处理",
    };
    service.saveSettings({
      loginStartupCheckEnabled: false,
      windowsNotificationEnabled: true,
      space: disabledGroup,
      child: disabledGroup,
    });

    await expect(service.run("startup")).resolves.toEqual({
      spaces: 0,
      children: 0,
      emailsSent: 0,
      windowsNotifications: 0,
    });
    expect(notificationState.shown).toBe(0);
  });

  it("shows the startup Windows notification before waiting for email delivery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-reminder-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    databases.push(database);
    const repository = new TeamRentalRepository(database);
    const today = localDateNow();
    repository.saveSpace({
      displayName: "今天到期", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "CN",
      sourceCurrency: "USD", sourceCostMinor: 2_500, openedOn: "2026-01-01", currentCycleStartedOn: "2026-07-01",
      renewsOn: today, renewalAnchorDay: Number(today.slice(8, 10)), cycleMonths: 1, motherSeatKind: "chatgpt", motherSeatFlexible: false,
      paymentMethodIds: [], defaultPaymentMethodId: null,
    });
    const service = new ReminderService(database, repository, fakePlatform());
    const group = {
      enabled: true, scheduledEnabled: true, startupCheckEnabled: true, repeatSameDayEnabled: true,
      recipientEmail: "to@example.com", sendTime: "08:00", thresholdDays: 5,
      smtpUrl: "smtps://user:password@example.com:465", smtpFrom: "from@example.com",
      templateSubject: "{{count}} 个提醒", templateBody: "请处理",
    };
    service.saveSettings({
      loginStartupCheckEnabled: true,
      windowsNotificationEnabled: true,
      space: group,
      child: { ...group, enabled: false, startupCheckEnabled: false },
    });
    let releaseEmail!: () => void;
    const emailGate = new Promise<void>((resolve) => { releaseEmail = resolve; });
    (service as unknown as { send: () => Promise<void> }).send = vi.fn(async () => emailGate);

    const run = service.run("startup", ["space"]);
    await Promise.resolve();
    const shownBeforeEmailFinished = notificationState.shown;
    releaseEmail();
    await run;
    expect(shownBeforeEmailFinished).toBe(1);
  });
});
