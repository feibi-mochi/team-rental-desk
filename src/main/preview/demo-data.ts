import { join } from "node:path";
import { addCalendarMonthsClamped, localDateNow } from "../domain/calendar.js";
import type { TeamRentalDatabase } from "../database/database.js";
import type { TeamRentalRepository } from "../database/repository.js";

const DEMO_SEED_KEY = "preview.demo.seeded";
const DEMO_SEED_VERSION = "v1.0.0";

function savePreviewSecurityState(
  database: TeamRentalDatabase,
  needsSetup: boolean,
  requirePasswordOnStartup: boolean,
): void {
  database.db.transaction(() => {
    for (const [key, value] of Object.entries({
      "security.password.needsSetup": String(needsSetup),
      "security.requirePasswordOnStartup": String(requirePasswordOnStartup),
      "security.password.scrypt": "",
      "security.password.sha256": "",
      "security.lockout.failures": "0",
      "security.lockout.windowStartedAt": "0",
      "security.lockout.until": "0",
    })) database.setSetting(key, value);
  })();
}

export function prepareDevelopmentDemoAccess(database: TeamRentalDatabase): void {
  savePreviewSecurityState(database, false, false);
}

export function prepareDevelopmentFirstRun(database: TeamRentalDatabase): void {
  savePreviewSecurityState(database, true, true);
}

type SpaceSeed = {
  displayName: string;
  ownerLogin: string;
  serviceKind: "chatgpt" | "codex";
  sourceCurrency: "USD" | "CNY";
  sourceCostMinor: number;
  dueOffsetDays: number;
  paymentMethodIds: string[];
  defaultPaymentMethodId: string;
  renewedThisMonth: boolean;
};

type ChildSeed = {
  spaceId: string;
  positionNumber: 1 | 2;
  seatKind: "chatgpt" | "codex";
  usageKind: "rental" | "self_use";
  customerLogin: string;
  label: string;
  contact: string;
  chargeCurrency: "USD" | "CNY";
  chargeMinor: number;
  joinedMonthsAgo: number;
  paymentDay: number;
  partialCurrentMinor?: number;
};

function dateParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`无效演示日期：${value}`);
  return { year, month, day };
}

function monthDate(base: string, monthOffset: number, preferredDay: number): string {
  const { year, month } = dateParts(base);
  const monthStart = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
  return addCalendarMonthsClamped(monthStart, monthOffset, preferredDay);
}

function addDays(value: string, amount: number): string {
  const { year, month, day } = dateParts(value);
  const target = new Date(Date.UTC(year, month - 1, day + amount));
  return [target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate()]
    .map((part, index) => index === 0 ? part.toString().padStart(4, "0") : part.toString().padStart(2, "0"))
    .join("-");
}

function dayOfMonth(value: string): number {
  return dateParts(value).day;
}

function demoInstant(localDate: string, hour = 10, minute = 0): string {
  return `${localDate}T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00+08:00`;
}

function assertEmptyBusinessDatabase(database: TeamRentalDatabase): void {
  const tables = ["team_space", "child_seat", "seat_billing_cycle", "receipt", "renewal_event", "payment_method", "local_shortcut"];
  const populated = tables.filter((table) => {
    const row = database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return row.count > 0;
  });
  if (populated.length > 0) {
    throw new Error(`截图演示目录并非空数据库，已停止写入：${populated.join(", ")}`);
  }
}

function createSpace(
  repository: TeamRentalRepository,
  today: string,
  seed: SpaceSeed,
): string {
  const finalRenewsOn = addDays(today, seed.dueOffsetDays);
  const anchorDay = dayOfMonth(finalRenewsOn);
  const initialRenewsOn = seed.renewedThisMonth
    ? addCalendarMonthsClamped(finalRenewsOn, -1, anchorDay)
    : finalRenewsOn;
  const currentCycleStartedOn = addCalendarMonthsClamped(initialRenewsOn, -1, anchorDay);
  const openedOn = addCalendarMonthsClamped(currentCycleStartedOn, -4, anchorDay);
  const spaceId = repository.saveSpace({
    displayName: seed.displayName,
    serviceKind: seed.serviceKind,
    ownerLogin: seed.ownerLogin,
    countryCode: "CN",
    sourceCurrency: seed.sourceCurrency,
    sourceCostMinor: seed.sourceCostMinor,
    openedOn,
    currentCycleStartedOn,
    renewsOn: initialRenewsOn,
    renewalAnchorDay: anchorDay,
    cycleMonths: 1,
    motherSeatKind: seed.serviceKind,
    motherSeatFlexible: true,
    paymentMethodIds: seed.paymentMethodIds,
    defaultPaymentMethodId: seed.defaultPaymentMethodId,
  });
  if (seed.renewedThisMonth) {
    const frozenUsdMinor = seed.sourceCurrency === "USD"
      ? seed.sourceCostMinor
      : Math.round(seed.sourceCostMinor / 7.18);
    repository.renewSpace({
      spaceId,
      frozenUsdMinor,
      paidAt: demoInstant(today, 9),
    });
  }
  return spaceId;
}

function createChild(
  repository: TeamRentalRepository,
  today: string,
  seed: ChildSeed,
): string {
  const joinedOn = monthDate(today, -seed.joinedMonthsAgo, seed.paymentDay);
  const nextPaymentOn = addCalendarMonthsClamped(joinedOn, 1, seed.paymentDay);
  const childSeatId = repository.saveChildSeat({
    spaceId: seed.spaceId,
    positionNumber: seed.positionNumber,
    seatKind: seed.seatKind,
    usageKind: seed.usageKind,
    customerLogin: seed.customerLogin,
    label: seed.label,
    contact: seed.contact,
    joinedOn,
    chargeCurrency: seed.chargeCurrency,
    chargeMinor: seed.chargeMinor,
    paymentDay: seed.paymentDay,
    nextPaymentOn,
    cycleMonths: 1,
  });
  if (seed.usageKind === "self_use") return childSeatId;

  repository.recordReceipt({
    childSeatId,
    grossMinor: seed.chargeMinor,
    feeBasisPoints: 60,
    receivedAt: demoInstant(joinedOn, 11),
  });
  for (let cycle = 1; cycle <= seed.joinedMonthsAgo; cycle += 1) {
    const receivedOn = addCalendarMonthsClamped(joinedOn, cycle, seed.paymentDay);
    if (receivedOn > today) break;
    const isCurrentPartial = receivedOn.slice(0, 7) === today.slice(0, 7) && seed.partialCurrentMinor;
    repository.recordReceipt({
      childSeatId,
      grossMinor: isCurrentPartial ? seed.partialCurrentMinor! : seed.chargeMinor,
      feeBasisPoints: cycle % 2 === 0 ? 160 : 0,
      receivedAt: demoInstant(receivedOn, 14, cycle),
    });
  }
  return childSeatId;
}

export function seedDevelopmentDemoData(
  database: TeamRentalDatabase,
  repository: TeamRentalRepository,
  now = new Date(),
): boolean {
  const existingVersion = database.getSetting(DEMO_SEED_KEY);
  if (existingVersion === DEMO_SEED_VERSION) return false;
  if (existingVersion) throw new Error(`截图演示数据版本不匹配：${existingVersion}`);
  assertEmptyBusinessDatabase(database);
  const today = localDateNow(now);

  database.db.transaction(() => {
    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('CNY', '7.18', 'demo-fixed', ?)
      ON CONFLICT(code) DO UPDATE SET
        units_per_usd = excluded.units_per_usd,
        provider = excluded.provider,
        quoted_at = excluded.quoted_at
    `).run(now.toISOString());
    for (const [key, value] of Object.entries({
      "backup.onClose": "false",
      "backup.intervalEnabled": "false",
      "reminder.startup.enabled": "false",
      "reminder.windows.enabled": "false",
      "space.emailReminder.enabled": "false",
      "childAccount.emailReminder.enabled": "false",
      "ui.palette.mode": "indigo",
    })) database.setSetting(key, value);

    const card = repository.savePaymentMethod({ name: "企业 Visa", note: "演示渠道" });
    const alipay = repository.savePaymentMethod({ name: "支付宝", note: "演示渠道" });
    const transfer = repository.savePaymentMethod({ name: "银行转账", note: "演示渠道" });

    const atlas = createSpace(repository, today, {
      displayName: "Atlas 设计组", ownerLogin: "owner.atlas@example.com", serviceKind: "chatgpt",
      sourceCurrency: "USD", sourceCostMinor: 20_000, dueOffsetDays: 3,
      paymentMethodIds: [card, alipay], defaultPaymentMethodId: alipay, renewedThisMonth: true,
    });
    const cedar = createSpace(repository, today, {
      displayName: "Cedar 研发组", ownerLogin: "owner.cedar@example.com", serviceKind: "codex",
      sourceCurrency: "CNY", sourceCostMinor: 149_900, dueOffsetDays: 0,
      paymentMethodIds: [transfer], defaultPaymentMethodId: transfer, renewedThisMonth: true,
    });
    const aurora = createSpace(repository, today, {
      displayName: "Aurora 运营组", ownerLogin: "owner.aurora@example.com", serviceKind: "chatgpt",
      sourceCurrency: "USD", sourceCostMinor: 19_900, dueOffsetDays: 24,
      paymentMethodIds: [card, alipay], defaultPaymentMethodId: card, renewedThisMonth: true,
    });
    const harbor = createSpace(repository, today, {
      displayName: "Harbor 测试组", ownerLogin: "owner.harbor@example.com", serviceKind: "codex",
      sourceCurrency: "CNY", sourceCostMinor: 128_000, dueOffsetDays: -4,
      paymentMethodIds: [transfer, alipay], defaultPaymentMethodId: transfer, renewedThisMonth: false,
    });

    const children: ChildSeed[] = [
      { spaceId: atlas, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental", customerLogin: "member.a@example.com", label: "视觉协作位", contact: "contact.a@example.com", chargeCurrency: "CNY", chargeMinor: 11_900, joinedMonthsAgo: 3, paymentDay: 5 },
      { spaceId: atlas, positionNumber: 2, seatKind: "chatgpt", usageKind: "rental", customerLogin: "member.b@example.com", label: "内容协作位", contact: "contact.b@example.com", chargeCurrency: "CNY", chargeMinor: 12_500, joinedMonthsAgo: 1, paymentDay: 16 },
      { spaceId: cedar, positionNumber: 1, seatKind: "codex", usageKind: "rental", customerLogin: "member.c@example.com", label: "研发协作位", contact: "contact.c@example.com", chargeCurrency: "CNY", chargeMinor: 13_800, joinedMonthsAgo: 2, paymentDay: 8 },
      { spaceId: cedar, positionNumber: 2, seatKind: "codex", usageKind: "self_use", customerLogin: "internal.cedar@example.com", label: "内部自用", contact: "ops.cedar@example.com", chargeCurrency: "CNY", chargeMinor: 0, joinedMonthsAgo: 3, paymentDay: 18 },
      { spaceId: aurora, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental", customerLogin: "member.d@example.com", label: "运营协作位", contact: "contact.d@example.com", chargeCurrency: "USD", chargeMinor: 1_500, joinedMonthsAgo: 2, paymentDay: 10 },
      { spaceId: aurora, positionNumber: 2, seatKind: "chatgpt", usageKind: "rental", customerLogin: "member.e@example.com", label: "增长协作位", contact: "contact.e@example.com", chargeCurrency: "CNY", chargeMinor: 13_800, joinedMonthsAgo: 1, paymentDay: 3, partialCurrentMinor: 6_000 },
      { spaceId: harbor, positionNumber: 1, seatKind: "codex", usageKind: "rental", customerLogin: "member.f@example.com", label: "测试协作位", contact: "contact.f@example.com", chargeCurrency: "CNY", chargeMinor: 12_900, joinedMonthsAgo: 1, paymentDay: 12 },
      { spaceId: harbor, positionNumber: 2, seatKind: "codex", usageKind: "self_use", customerLogin: "internal.harbor@example.com", label: "内部自用", contact: "ops.harbor@example.com", chargeCurrency: "CNY", chargeMinor: 0, joinedMonthsAgo: 2, paymentDay: 20 },
    ];
    for (const child of children) createChild(repository, today, child);

    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    repository.saveShortcut({ label: "打开成员清单", targetPath: join(systemRoot, "System32", "notepad.exe"), spaceId: atlas });
    repository.saveShortcut({ label: "打开账务备注", targetPath: join(systemRoot, "System32", "notepad.exe"), spaceId: cedar });
    repository.saveShortcut({ label: "打开续费检查", targetPath: join(systemRoot, "System32", "notepad.exe"), spaceId: null });
    database.setSetting(DEMO_SEED_KEY, DEMO_SEED_VERSION);
  })();
  prepareDevelopmentDemoAccess(database);
  return true;
}
