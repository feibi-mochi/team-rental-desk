import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type {
  ReminderGroupSettings,
  ReminderRunResult,
  ReminderSettings,
  SpaceListItem,
} from "../../shared/contracts.js";
import { classifyExpiry, localDateNow } from "../domain/calendar.js";
import { convertCurrencyMinor } from "../domain/money-conversion.js";
import type { TeamRentalDatabase } from "../database/database.js";
import type { TeamRentalRepository } from "../database/repository.js";
import type { DesktopPlatform } from "../platform/contracts.js";
import {
  normalizeReminderBody,
  normalizeReminderSubject,
  type ReminderKind,
} from "./defaults.js";

function bool(value: string | null, fallback = false): boolean {
  return value === null ? fallback : value === "true";
}

function numberSetting(value: string | null, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 90 ? number : fallback;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(minor: number, code: string, decimals = 2): string {
  if (code === "USDT") return `₮${(minor / 10 ** decimals).toFixed(decimals)} USDT`;
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(minor / 10 ** decimals);
  } catch {
    return `${(minor / 10 ** decimals).toFixed(decimals)} ${code}`;
  }
}

function replaceCount(template: string, count: number): string {
  return template.replaceAll("{{count}}", String(count));
}

function statusText(status: SpaceListItem["expiryStatus"]): string {
  return { normal: "正常", soon: "即将到期", today: "今天到期", overdue: "已过期" }[status];
}

function shell(title: string, intro: string, cards: string): string {
  return `<!doctype html>
  <html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;background:#f3f6f5;font-family:'Microsoft YaHei',Arial,sans-serif;color:#17201d">
    <div style="max-width:680px;margin:0 auto;padding:24px 12px">
      <div style="background:#ffffff;border:1px solid #dce7e3;border-radius:18px;overflow:hidden;box-shadow:0 8px 26px rgba(24,62,53,.08)">
        <div style="padding:24px 26px;background:linear-gradient(135deg,#3f897d,#76b7ad);color:#fff">
          <div style="font-size:12px;letter-spacing:.16em;opacity:.82">TEAM RENTAL</div>
          <h1 style="margin:8px 0 0;font-size:24px">${escapeHtml(title)}</h1>
        </div>
        <div style="padding:22px 26px">
          <p style="margin:0 0 18px;color:#60716b;line-height:1.7">${escapeHtml(intro)}</p>
          ${cards}
          <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e8eeeb;color:#87938f;font-size:12px">此邮件由本机 Team 出租管理自动生成。程序关闭期间不会定时发送。</p>
        </div>
      </div>
    </div>
  </body></html>`;
}

export class ReminderService {
  constructor(
    private readonly database: TeamRentalDatabase,
    private readonly repository: TeamRentalRepository,
    private readonly platform: Pick<
      DesktopPlatform,
      "setStartupCheckEnabled" | "showNotification"
    >,
  ) {
    this.syncLoginItem();
  }

  private group(prefix: "space" | "childAccount"): ReminderGroupSettings {
    const get = (suffix: string) => this.database.getSetting(`${prefix}.emailReminder.${suffix}`);
    const isSpace = prefix === "space";
    return {
      enabled: bool(get("enabled")),
      scheduledEnabled: bool(get("scheduledEnabled")),
      startupCheckEnabled: bool(get("startupCheckEnabled")),
      repeatSameDayEnabled: bool(get("repeatSameDayEnabled")),
      recipientEmail: get("recipientEmail") ?? "",
      sendTime: get("sendTime") ?? "08:00",
      thresholdDays: numberSetting(
        this.database.getSetting(isSpace ? "space.status.soonDays" : "childAccount.status.soonDays"),
        5,
      ),
      smtpUrl: get("smtpUrl") ?? "",
      smtpFrom: get("smtpFrom") ?? "",
      templateSubject: normalizeReminderSubject(get("templateSubject"), isSpace ? "space" : "child"),
      templateBody: normalizeReminderBody(get("templateBody"), isSpace ? "space" : "child"),
    };
  }

  getSettings(): ReminderSettings {
    return {
      loginStartupCheckEnabled: bool(this.database.getSetting("reminder.startup.enabled")),
      windowsNotificationEnabled: bool(this.database.getSetting("reminder.windows.enabled"), true),
      space: this.group("space"),
      child: this.group("childAccount"),
    };
  }

  saveSettings(settings: ReminderSettings): void {
    for (const group of [settings.space, settings.child]) {
      if (!/^\d{2}:\d{2}$/.test(group.sendTime)) throw new Error("发送时间格式应为 HH:mm");
      if (!Number.isInteger(group.thresholdDays) || group.thresholdDays < 0 || group.thresholdDays > 90) {
        throw new Error("提醒天数必须在 0 到 90 之间");
      }
      if (group.enabled) {
        if (!group.recipientEmail.includes("@")) throw new Error("请填写有效的接收邮箱");
        if (!group.smtpFrom.includes("@")) throw new Error("请填写有效的发件邮箱");
        let protocol = "";
        try { protocol = new URL(group.smtpUrl).protocol; } catch { throw new Error("SMTP URL 格式不正确"); }
        if (!['smtp:', 'smtps:'].includes(protocol)) throw new Error("SMTP URL 必须以 smtp:// 或 smtps:// 开头");
      }
    }
    const writeGroup = (prefix: "space" | "childAccount", group: ReminderGroupSettings) => {
      for (const [key, value] of Object.entries({
        enabled: group.enabled,
        scheduledEnabled: group.scheduledEnabled,
        startupCheckEnabled: group.startupCheckEnabled,
        repeatSameDayEnabled: group.repeatSameDayEnabled,
        recipientEmail: group.recipientEmail,
        sendTime: group.sendTime,
        smtpUrl: group.smtpUrl,
        smtpFrom: group.smtpFrom,
        templateSubject: group.templateSubject,
        templateBody: group.templateBody,
      })) this.database.setSetting(`${prefix}.emailReminder.${key}`, String(value));
      this.database.setSetting(
        prefix === "space" ? "space.status.soonDays" : "childAccount.status.soonDays",
        String(group.thresholdDays),
      );
    };
    this.database.db.transaction(() => {
      this.database.setSetting("reminder.startup.enabled", String(settings.loginStartupCheckEnabled));
      this.database.setSetting("reminder.windows.enabled", String(settings.windowsNotificationEnabled));
      writeGroup("space", settings.space);
      writeGroup("childAccount", settings.child);
    })();
    this.syncLoginItem(settings);
  }

  private syncLoginItem(settings = this.getSettings()): void {
    this.platform.setStartupCheckEnabled(settings.loginStartupCheckEnabled);
  }

  private alreadySent(
    subjectKind: "space" | "child_seat",
    subjectId: string,
    today: string,
  ): boolean {
    return Boolean(this.database.db.prepare(`
      SELECT 1 FROM reminder_delivery
      WHERE subject_kind = ? AND subject_id = ? AND channel = 'email'
        AND local_date = ? AND outcome = 'sent'
      LIMIT 1
    `).get(subjectKind, subjectId, today));
  }

  private mark(
    subjectKind: "space" | "child_seat",
    subjectId: string,
    channel: "email" | "windows",
    trigger: "startup" | "scheduled" | "test",
    today: string,
    outcome: "sent" | "skipped" | "failed",
  ): void {
    this.database.db.prepare(`
      INSERT INTO reminder_delivery(
        id, subject_kind, subject_id, channel, trigger_kind, local_date, sent_at, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), subjectKind, subjectId, channel, trigger, today, new Date().toISOString(), outcome);
  }

  private async send(group: ReminderGroupSettings, subject: string, html: string): Promise<void> {
    if (!group.smtpUrl || !group.recipientEmail || !group.smtpFrom) throw new Error("邮件设置不完整");
    const transport = nodemailer.createTransport(group.smtpUrl, {
      disableFileAccess: true,
      disableUrlAccess: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    try {
      await transport.sendMail({
        from: group.smtpFrom,
        to: group.recipientEmail,
        subject,
        html,
        text: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      });
    } finally {
      transport.close();
    }
  }

  private currencyDecimals(code: string): number {
    const row = this.database.db.prepare("SELECT decimal_places FROM money_unit WHERE code = ?").get(code) as
      | { decimal_places: number }
      | undefined;
    return row?.decimal_places ?? 2;
  }

  private spaceHtml(spaces: SpaceListItem[], group: ReminderGroupSettings): string {
    const cards = spaces.map((space) => {
      const original = money(
        space.sourceCost.minor,
        space.sourceCost.currency,
        this.currencyDecimals(space.sourceCost.currency),
      );
      const usd = space.sourceCostUsdMinor === null ? "暂无冻结值" : money(space.sourceCostUsdMinor, "USD");
      const cny = space.sourceCostCnyMinor === null ? "暂无冻结值" : money(space.sourceCostCnyMinor, "CNY");
      const usdt = space.sourceCostUsdMinor === null
        ? null
        : this.fromUsd(space.sourceCostUsdMinor, "USDT");
      const frozenReferences = [usd, cny, usdt]
        .filter((value): value is string => Boolean(value))
        .join(" / ");
      const channel = space.paymentMethods.find((item) => item.isDefault)?.name ?? "未设置默认渠道";
      return `<div style="margin:0 0 12px;padding:16px 18px;border:1px solid #e1e9e6;border-radius:13px;background:#fbfcfc">
        <div style="display:flex;justify-content:space-between;gap:12px"><strong style="font-size:17px">${escapeHtml(space.displayName)}</strong><span style="color:#a76a08">${statusText(space.expiryStatus)}</span></div>
        <div style="margin-top:10px;color:#53645e;line-height:1.8">到期日：<strong>${escapeHtml(space.renewsOn)}</strong><br>默认支付渠道：${escapeHtml(channel)}<br>原币应付：${escapeHtml(original)}<br>冻结参考：${escapeHtml(frozenReferences)}</div>
      </div>`;
    }).join("");
    return shell("空间续费提醒", group.templateBody, cards);
  }

  private fromUsd(usdMinor: number, targetCode: string): string | null {
    const target = this.database.db.prepare(`
      SELECT u.decimal_places, q.units_per_usd
      FROM money_unit u JOIN exchange_quote q ON q.code = u.code
      WHERE u.code = ? AND u.enabled = 1 AND u.deleted_at IS NULL
    `).get(targetCode) as { decimal_places: number; units_per_usd: string } | undefined;
    if (!target) return null;
    const converted = convertCurrencyMinor(
      usdMinor,
      { decimalPlaces: 2, unitsPerUsd: "1" },
      { decimalPlaces: target.decimal_places, unitsPerUsd: target.units_per_usd },
    );
    return money(converted, targetCode, target.decimal_places);
  }

  private childHtml(
    children: Array<{ space: SpaceListItem; seat: SpaceListItem["childSeats"][number] }>,
    group: ReminderGroupSettings,
  ): string {
    const cards = children.map(({ space, seat }) => `<div style="margin:0 0 12px;padding:16px 18px;border:1px solid #e1e9e6;border-radius:13px;background:#fbfcfc">
      <div style="display:flex;justify-content:space-between;gap:12px"><strong style="font-size:17px">${escapeHtml(space.displayName)} · 位置 ${seat.positionNumber}</strong><span style="color:#a76a08">${seat.collectionStatus === "new_customer" ? "新客户，待记账" : statusText(seat.expiryStatus)}</span></div>
      <div style="margin-top:10px;color:#53645e;line-height:1.8">账号：${escapeHtml(seat.customerLogin)}<br>联系人：${escapeHtml(seat.contact || "未填写")}<br>付款日：${escapeHtml(seat.nextPaymentOn)}<br>应收：<strong>${escapeHtml(money(seat.charge.minor, seat.charge.currency, this.currencyDecimals(seat.charge.currency)))}</strong></div>
    </div>`).join("");
    return shell("子位置收款提醒", group.templateBody, cards);
  }

  private dueItems(settings: ReminderSettings, today: string) {
    const spaces = this.repository.listSpaces(today);
    const dueSpaces = spaces.filter((space) => classifyExpiry(space.renewsOn, today, settings.space.thresholdDays) !== "normal");
    const dueChildren = spaces.flatMap((space) =>
      space.childSeats
        .filter((seat) => seat.usageKind === "rental")
        .filter((seat) => seat.pendingFirstReceipt || classifyExpiry(seat.nextPaymentOn, today, settings.child.thresholdDays) !== "normal")
        .map((seat) => ({ space, seat })),
    );
    return { dueSpaces, dueChildren };
  }

  async run(
    trigger: "startup" | "scheduled",
    kinds: ReminderKind[] = ["space", "child"],
  ): Promise<ReminderRunResult> {
    const settings = this.getSettings();
    const today = localDateNow();
    const { dueSpaces, dueChildren } = this.dueItems(settings, today);
    let emailsSent = 0;
    let windowsNotifications = 0;
    const shouldRun = (group: ReminderGroupSettings) =>
      group.enabled && (trigger === "startup" ? group.startupCheckEnabled : group.scheduledEnabled);

    if (
      trigger === "startup" &&
      settings.windowsNotificationEnabled &&
      (dueSpaces.length || dueChildren.length) &&
      this.platform.showNotification({
        title: "Team 出租管理到期自检",
        body: `空间 ${dueSpaces.length} 个，子位置 ${dueChildren.length} 个需要处理。`,
      })
    ) {
      windowsNotifications = 1;
      for (const space of dueSpaces) this.mark("space", space.id, "windows", trigger, today, "sent");
      for (const child of dueChildren) this.mark("child_seat", child.seat.id, "windows", trigger, today, "sent");
    }

    const sendGroup = async (
      kind: "space" | "child",
      group: ReminderGroupSettings,
      items: typeof dueSpaces | typeof dueChildren,
    ) => {
      if (!shouldRun(group) || items.length === 0) return;
      const filtered = group.repeatSameDayEnabled
        ? items
        : items.filter((item) => {
            const id = kind === "space" ? (item as SpaceListItem).id : (item as (typeof dueChildren)[number]).seat.id;
            return !this.alreadySent(kind === "space" ? "space" : "child_seat", id, today);
          });
      if (filtered.length === 0) return;
      const subject = replaceCount(group.templateSubject, filtered.length);
      const html = kind === "space"
        ? this.spaceHtml(filtered as typeof dueSpaces, group)
        : this.childHtml(filtered as typeof dueChildren, group);
      try {
        await this.send(group, subject, html);
        emailsSent += 1;
        for (const item of filtered) {
          const id = kind === "space" ? (item as SpaceListItem).id : (item as (typeof dueChildren)[number]).seat.id;
          this.mark(kind === "space" ? "space" : "child_seat", id, "email", trigger, today, "sent");
        }
      } catch (error) {
        for (const item of filtered) {
          const id = kind === "space" ? (item as SpaceListItem).id : (item as (typeof dueChildren)[number]).seat.id;
          this.mark(kind === "space" ? "space" : "child_seat", id, "email", trigger, today, "failed");
        }
        throw error;
      }
    };

    let firstError: unknown = null;
    if (kinds.includes("space")) {
      try { await sendGroup("space", settings.space, dueSpaces); } catch (error) { firstError ??= error; }
    }
    if (kinds.includes("child")) {
      try { await sendGroup("child", settings.child, dueChildren); } catch (error) { firstError ??= error; }
    }

    if (firstError) throw firstError;
    return { spaces: dueSpaces.length, children: dueChildren.length, emailsSent, windowsNotifications };
  }

  async runScheduledIfDue(): Promise<ReminderRunResult | null> {
    const settings = this.getSettings();
    const today = localDateNow();
    const due = this.dueItems(settings, today);
    const signatures = {
      space: due.dueSpaces.map((space) => space.id).sort().join("|"),
      child: due.dueChildren.map(({ seat }) => seat.id).sort().join("|"),
    };
    const nowTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date());
    const dueKinds = ([
      ["space", settings.space],
      ["child", settings.child],
    ] as const).filter(([kind, group]) =>
      group.enabled &&
      group.scheduledEnabled &&
      nowTime >= group.sendTime &&
      (this.database.getSetting(`reminder.scheduled.${kind}.lastRunDate`) !== today ||
        this.database.getSetting(`reminder.scheduled.${kind}.lastDueSignature`) !==
          signatures[kind]),
    ).map(([kind]) => kind);
    if (dueKinds.length === 0) return null;
    let combined: ReminderRunResult | null = null;
    let firstError: unknown = null;
    for (const kind of dueKinds) {
      try {
        const result = await this.run("scheduled", [kind]);
        this.database.setSetting(`reminder.scheduled.${kind}.lastRunDate`, today);
        this.database.setSetting(
          `reminder.scheduled.${kind}.lastDueSignature`,
          signatures[kind],
        );
        combined = combined
          ? { ...result, emailsSent: combined.emailsSent + result.emailsSent, windowsNotifications: 0 }
          : result;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
    return combined;
  }

  async sendTest(kind: "space" | "child"): Promise<void> {
    const settings = this.getSettings();
    const group = kind === "space" ? settings.space : settings.child;
    await this.send(
      group,
      `Team 出租管理｜${kind === "space" ? "空间" : "子位置"}提醒测试成功`,
      shell(
        `${kind === "space" ? "空间" : "子位置"}提醒测试`,
        "这是一封测试邮件。你能看到它，说明 SMTP、发件邮箱和接收邮箱均可使用。",
        `<div style="padding:16px 18px;border:1px solid #e1e9e6;border-radius:13px;background:#fbfcfc">发送时间：${escapeHtml(new Date().toLocaleString("zh-CN"))}</div>`,
      ),
    );
    this.mark(kind === "space" ? "space" : "child_seat", `test:${kind}`, "email", "test", localDateNow(), "sent");
  }

  sendWindowsTest(): void {
    if (!this.platform.showNotification({
      title: "Team 出租管理通知测试",
      body: "以后开机提醒会显示在右下角，不会弹到屏幕中央。",
    })) throw new Error("当前系统通知不可用，请检查系统通知设置");
  }
}
