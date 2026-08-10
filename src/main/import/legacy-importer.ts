import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { LegacyImportResult } from "../../shared/contracts.js";
import { addCalendarMonthsClamped, localDateFromInstant } from "../domain/calendar.js";
import type { BackupService } from "../backup/backup-service.js";
import type { TeamRentalDatabase } from "../database/database.js";
import { normalizeReminderBody, normalizeReminderSubject } from "../reminders/defaults.js";

type LegacyCurrency = {
  code: string;
  name: string;
  minor_unit: number;
  is_active: number;
  symbol: string;
};

function normalizeInstant(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function dayOf(date: string): number {
  const value = Number(date.slice(8, 10));
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : 1;
}

function legacyShortcutPath(stored: string, displayName: string): string {
  const candidates = [
    join(homedir(), "Desktop", "ChatGPT", stored),
    join(homedir(), "Desktop", "ChatGPT", `${displayName}.lnk`),
    join(homedir(), "Desktop", stored),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? stored;
}

function importedFeeBasisPoints(value: unknown): 0 | 60 | 160 {
  const number = Number(value);
  return number === 60 || number === 160 ? number : 0;
}

export class LegacyImporter {
  constructor(
    private readonly target: TeamRentalDatabase,
    private readonly backupService: BackupService,
  ) {}

  async import(sourcePath: string): Promise<LegacyImportResult> {
    const resolvedSource = resolve(sourcePath);
    if (!existsSync(resolvedSource) || basename(resolvedSource).toLowerCase() !== "app.db") {
      throw new Error("请选择旧版 data 文件夹里的 app.db");
    }
    const current = this.target.summary();
    if (current.spaces || current.motherAccounts || current.childSeats || current.paymentChannels) {
      throw new Error("当前数据库已有业务数据。为避免混合和重复，只能导入到空白数据库");
    }
    const preImportBackup = await this.backupService.run("pre_import");
    const source = new Database(resolvedSource, { readonly: true, fileMustExist: true });
    try {
      const tableRows = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      const tables = new Set(tableRows.map((row) => row.name));
      for (const required of ["space", "mother_account", "child_account", "payment_channel", "currency"]) {
        if (!tables.has(required)) throw new Error(`所选数据库缺少旧版数据表：${required}`);
      }

      const expectedSpaces = Number((source.prepare("SELECT COUNT(*) AS count FROM space").get() as { count: number }).count);
      const expectedChildren = Number((source.prepare("SELECT COUNT(*) AS count FROM child_account").get() as { count: number }).count);
      let receiptCount = 0;
      const importedSummary = this.target.db.transaction(() => {
        const now = new Date().toISOString();
        const currencies = source.prepare("SELECT * FROM currency ORDER BY code").all() as LegacyCurrency[];
        const unitInsert = this.target.db.prepare(`
          INSERT INTO money_unit(code, name, symbol, decimal_places, enabled, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(code) DO UPDATE SET
            name = excluded.name,
            symbol = excluded.symbol,
            decimal_places = excluded.decimal_places,
            enabled = excluded.enabled,
            deleted_at = NULL
        `);
        currencies.forEach((row, index) =>
          unitInsert.run(row.code, row.name, row.symbol || row.code, row.minor_unit, row.is_active ? 1 : 0, index),
        );

        if (tables.has("fx_rate")) {
          const rates = source.prepare("SELECT * FROM fx_rate").all() as Array<{
            currency_code: string;
            rate_to_usd: string;
            fetched_at: string;
          }>;
          const quoteInsert = this.target.db.prepare(`
            INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
            VALUES (?, ?, 'legacy-import', ?)
            ON CONFLICT(code) DO UPDATE SET
              units_per_usd = excluded.units_per_usd,
              provider = excluded.provider,
              quoted_at = excluded.quoted_at
          `);
          for (const rate of rates) {
            const usdPerUnit = Number(rate.rate_to_usd);
            if (Number.isFinite(usdPerUnit) && usdPerUnit > 0) {
              quoteInsert.run(rate.currency_code, String(1 / usdPerUnit), normalizeInstant(rate.fetched_at));
            }
          }
        }
        this.target.db.prepare(`
          INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
          VALUES ('USD', '1', 'fixed', ?)
          ON CONFLICT(code) DO UPDATE SET units_per_usd = '1', provider = 'fixed'
        `).run(now);

        const channels = source.prepare("SELECT * FROM payment_channel ORDER BY id").all() as Array<{
          id: number;
          name: string;
          is_active: number;
          created_at: string;
        }>;
        const channelInsert = this.target.db.prepare(`
          INSERT INTO payment_method(id, name, note, archived_at, created_at, updated_at)
          VALUES (?, ?, '', ?, ?, ?)
        `);
        for (const channel of channels) {
          const created = normalizeInstant(channel.created_at);
          channelInsert.run(
            `legacy:payment:${channel.id}`,
            channel.name,
            channel.is_active ? null : created,
            created,
            created,
          );
        }

        const mothers = source.prepare("SELECT * FROM mother_account").all() as Array<{
          id: number;
          space_id: number;
          email: string;
          seat_type: "chatgpt" | "codex";
          can_change_seat_type: number;
        }>;
        const motherBySpace = new Map(mothers.map((row) => [row.space_id, row]));
        const extraChannels = tables.has("space_payment_channel")
          ? (source.prepare("SELECT * FROM space_payment_channel ORDER BY space_id, position").all() as Array<{
              space_id: number;
              payment_channel_id: number;
              position: number;
            }>)
          : [];
        const channelsBySpace = new Map<number, Array<{ id: number; position: number }>>();
        for (const row of extraChannels) {
          const list = channelsBySpace.get(row.space_id) ?? [];
          list.push({ id: row.payment_channel_id, position: row.position });
          channelsBySpace.set(row.space_id, list);
        }

        const spaces = source.prepare("SELECT * FROM space ORDER BY id").all() as Array<Record<string, unknown>>;
        const spaceInsert = this.target.db.prepare(`
          INSERT INTO team_space(
            id, display_name, service_kind, owner_login, country_code, source_currency,
            source_cost_minor, opened_on, current_cycle_started_on, renews_on,
            renewal_anchor_day, cycle_months, archived_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const motherInsert = this.target.db.prepare(`
          INSERT INTO mother_account(
            id, space_id, login, seat_kind, can_change_seat_kind, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const spaceMethodInsert = this.target.db.prepare(`
          INSERT INTO space_payment_method(space_id, payment_method_id, is_default, sort_order)
          VALUES (?, ?, ?, ?)
        `);
        const renewalInsert = this.target.db.prepare(`
          INSERT INTO renewal_event(
            id, space_id, event_kind, previous_renews_on, next_renews_on,
            frozen_usd_minor, frozen_cny_minor, cny_per_usd, paid_at,
            paid_local_date, created_at
          ) VALUES (?, ?, 'imported', ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const shortcutInsert = this.target.db.prepare(`
          INSERT INTO local_shortcut(id, label, target_path, space_id, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `);

        for (const raw of spaces) {
          const legacyId = Number(raw.id);
          const spaceId = `legacy:space:${legacyId}`;
          const mother = motherBySpace.get(legacyId);
          const openedOn = String(raw.opening_date || raw.current_period_start_date || raw.expiry_date);
          const startedOn = String(raw.current_period_start_date || raw.opening_date || raw.expiry_date);
          const renewsOn = String(raw.expiry_date);
          const cycleMonths = String(raw.period_unit) === "year"
            ? Number(raw.period_count || 1) * 12
            : Math.max(1, Number(raw.period_count || 1));
          const serviceKind = mother?.seat_type === "codex" ? "codex" : "chatgpt";
          const sourceCostMinor = Number(raw.amount_minor || 0);
          if (!Number.isSafeInteger(sourceCostMinor) || sourceCostMinor <= 0) {
            throw new Error(`旧版空间“${String(raw.name)}”的成本不是有效正数，请先在旧版中修正`);
          }
          if (startedOn < openedOn || renewsOn <= startedOn) {
            throw new Error(`旧版空间“${String(raw.name)}”的日期顺序不正确，请先修正`);
          }
          const active = Boolean(raw.is_active);
          const updated = normalizeInstant(String(raw.rate_as_of || now));
          spaceInsert.run(
            spaceId,
            String(raw.name),
            serviceKind,
            mother?.email ?? String(raw.name),
            String(raw.country || "--"),
            String(raw.currency_code),
            sourceCostMinor,
            openedOn,
            startedOn,
            renewsOn,
            dayOf(openedOn),
            Math.min(36, cycleMonths),
            active ? null : normalizeInstant(String(raw.archived_at || now)),
            updated,
            updated,
          );
          motherInsert.run(
            `legacy:mother:${mother?.id ?? legacyId}`,
            spaceId,
            mother?.email ?? String(raw.name),
            serviceKind,
            mother?.can_change_seat_type ? 1 : 0,
            updated,
            updated,
          );
          const mappedChannels = channelsBySpace.get(legacyId) ?? [];
          if (!mappedChannels.some((entry) => entry.id === Number(raw.payment_channel_id))) {
            mappedChannels.unshift({ id: Number(raw.payment_channel_id), position: 0 });
          }
          const seen = new Set<number>();
          mappedChannels.slice(0, 4).forEach((entry, index) => {
            if (seen.has(entry.id)) return;
            seen.add(entry.id);
            spaceMethodInsert.run(
              spaceId,
              `legacy:payment:${entry.id}`,
              entry.id === Number(raw.payment_channel_id) ? 1 : 0,
              index,
            );
          });
          const usd = Number(raw.amount_usd || 0);
          const cny = Number(raw.amount_cny || 0);
          if (usd > 0 && cny > 0) {
            const paidAt = normalizeInstant(String(raw.rate_as_of || now));
            renewalInsert.run(
              `legacy:cost:${legacyId}`,
              spaceId,
              startedOn,
              renewsOn,
              usd,
              cny,
              String(cny / usd),
              paidAt,
              localDateFromInstant(paidAt),
              updated,
            );
          }
          if (raw.shortcut_file_name) {
            shortcutInsert.run(
              `legacy:shortcut:${legacyId}`,
              String(raw.name),
              legacyShortcutPath(String(raw.shortcut_file_name), String(raw.name)),
              spaceId,
              updated,
              updated,
            );
          }
        }

        const children = source.prepare("SELECT * FROM child_account ORDER BY space_id, id").all() as Array<Record<string, unknown>>;
        const positionBySpace = new Map<number, number>();
        const childInsert = this.target.db.prepare(`
          INSERT INTO child_seat(
            id, space_id, position_number, seat_kind, usage_kind, customer_login, label,
            contact, joined_on, charge_currency, charge_minor, payment_day,
            next_payment_on, cycle_months, pending_first_receipt, customer_revision,
            archived_at, archived_by_space, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `);
        for (const raw of children) {
          const legacySpaceId = Number(raw.space_id);
          const position = (positionBySpace.get(legacySpaceId) ?? 0) + 1;
          positionBySpace.set(legacySpaceId, position);
          const joinedOn = String(raw.joined_date);
          const paymentDay = Math.min(31, Math.max(1, Number(raw.monthly_payment_day || dayOf(joinedOn))));
          const cycleMonths = String(raw.billing_period_unit) === "year"
            ? Number(raw.billing_period_count || 1) * 12
            : Math.max(1, Number(raw.billing_period_count || 1));
          const storedNextPaymentOn = raw.next_payment_date
            ? String(raw.next_payment_date)
            : addCalendarMonthsClamped(joinedOn, cycleMonths, paymentDay);
          const nextPaymentOn = storedNextPaymentOn > joinedOn
            ? storedNextPaymentOn
            : addCalendarMonthsClamped(joinedOn, cycleMonths, paymentDay);
          const usageKind = raw.monthly_rate_source === "self-use" ? "self_use" : "rental";
          const chargeMinor = Number(raw.monthly_amount_minor || 0);
          if (usageKind === "rental" && (!Number.isSafeInteger(chargeMinor) || chargeMinor <= 0)) {
            throw new Error(`旧版子位置“${String(raw.email)}”的收费金额不是有效正数，请先修正`);
          }
          const created = normalizeInstant(String(raw.created_at || now));
          const parentSpace = spaces.find((space) => Number(space.id) === legacySpaceId);
          const parentActive = Boolean(parentSpace?.is_active);
          const parentArchivedAt = parentActive
            ? null
            : normalizeInstant(String(parentSpace?.archived_at || now));
          const childArchivedAt = raw.is_active && parentActive
            ? null
            : normalizeInstant(String(raw.archived_at || parentArchivedAt || now));
          const archivedBySpace = !parentActive && childArchivedAt === parentArchivedAt ? 1 : 0;
          childInsert.run(
            `legacy:child:${raw.id}`,
            `legacy:space:${legacySpaceId}`,
            position,
            raw.seat_type === "codex" ? "codex" : "chatgpt",
            usageKind,
            String(raw.email),
            String(raw.label || ""),
            String(raw.contact || ""),
            joinedOn,
            String(raw.monthly_currency_code),
            chargeMinor,
            paymentDay,
            nextPaymentOn,
            Math.min(36, cycleMonths),
            raw.initial_collection_received_at || raw.monthly_rate_source === "self-use" ? 0 : 1,
            childArchivedAt,
            archivedBySpace,
            created,
            normalizeInstant(String(raw.updated_at || created)),
          );
        }

        if (tables.has("child_account_payment")) {
          const payments = source.prepare("SELECT * FROM child_account_payment ORDER BY id").all() as Array<Record<string, unknown>>;
          const cycleInsert = this.target.db.prepare(`
            INSERT INTO seat_billing_cycle(
              id, child_seat_id, customer_revision, customer_login_snapshot,
              space_id_snapshot, space_name_snapshot, position_number_snapshot,
              cycle_kind, starts_on, due_on,
              coverage_ends_on, amount_due_minor, currency_code, closed_at, created_at
            ) VALUES (?, ?, 1, ?, ?, ?, ?, 'renewal', ?, ?, ?, ?, ?, ?, ?)
          `);
          const childSnapshot = this.target.db.prepare(`
            SELECT c.space_id, s.display_name, c.position_number
            FROM child_seat c
            JOIN team_space s ON s.id = c.space_id
            WHERE c.id = ?
          `);
          const receiptInsert = this.target.db.prepare(`
            INSERT INTO receipt(
              id, billing_cycle_id, gross_minor, fee_basis_points, fee_minor, net_minor,
              gross_usd_minor, gross_cny_minor, net_usd_minor, net_cny_minor,
              fx_provider, fx_quoted_at, received_at, received_local_date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy-import', ?, ?, ?, ?)
          `);
          for (const payment of payments) {
            const childId = `legacy:child:${payment.child_account_id}`;
            const dueOn = String(payment.due_date);
            const child = children.find((row) => Number(row.id) === Number(payment.child_account_id));
            const months = String(child?.billing_period_unit) === "year"
              ? Math.max(1, Number(child?.billing_period_count || 1)) * 12
              : Math.max(1, Number(child?.billing_period_count || 1));
            const anchor = Number(child?.monthly_payment_day || dayOf(dueOn));
            const cycleId = `legacy:cycle:${payment.id}`;
            const created = normalizeInstant(String(payment.created_at || now));
            const snapshot = childSnapshot.get(childId) as
              | { space_id: string; display_name: string; position_number: number }
              | undefined;
            if (!snapshot) throw new Error(`旧版子位置“${String(child?.email ?? childId)}”缺少所属空间`);
            cycleInsert.run(
              cycleId,
              childId,
              String(child?.email ?? "历史客户"),
              snapshot.space_id,
              snapshot.display_name,
              snapshot.position_number,
              dueOn,
              dueOn,
              addCalendarMonthsClamped(dueOn, months, anchor),
              Number(payment.expected_amount_minor || 0),
              String(payment.currency_code),
              payment.status === "paid" ? normalizeInstant(String(payment.paid_at || created)) : null,
              created,
            );
            if (tables.has("child_account_payment_receipt")) {
              const receipts = source.prepare("SELECT * FROM child_account_payment_receipt WHERE payment_id = ? ORDER BY id").all(payment.id) as Array<Record<string, unknown>>;
              for (const receipt of receipts) {
                const receivedAt = normalizeInstant(String(receipt.received_at || now));
                const gross = Number(receipt.received_amount_minor || 0);
                const fee = Number(receipt.fee_amount_minor || 0);
                const net = Math.max(0, gross - fee);
                const grossUsd = Number(receipt.amount_usd || 0);
                const netUsd = Number(receipt.net_amount_usd || grossUsd || 0);
                const netCny = Number(receipt.net_amount_cny || (payment.currency_code === "CNY" ? net : 0));
                const grossCny = payment.currency_code === "CNY"
                  ? gross
                  : net > 0
                    ? Math.round(netCny * gross / net)
                    : Math.max(netCny, 0);
                receiptInsert.run(
                  `legacy:receipt:${receipt.id}`,
                  cycleId,
                  gross,
                  importedFeeBasisPoints(receipt.fee_rate_bps),
                  fee,
                  net,
                  grossUsd,
                  grossCny,
                  netUsd,
                  netCny,
                  receivedAt,
                  receivedAt,
                  localDateFromInstant(receivedAt),
                  receivedAt,
                );
                receiptCount += 1;
              }
            }
          }
        }

        if (tables.has("app_setting")) {
          const settings = source.prepare("SELECT key, value FROM app_setting").all() as Array<{ key: string; value: string }>;
          const settingInsert = this.target.db.prepare(`
            INSERT INTO app_setting(key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `);
          for (const setting of settings) {
            const allowed =
              setting.key === "reminder.startup.enabled" ||
              setting.key === "space.status.soonDays" ||
              setting.key === "childAccount.status.soonDays" ||
              setting.key.startsWith("space.emailReminder.") ||
              setting.key.startsWith("childAccount.emailReminder.") ||
              setting.key === "ui.palette.mode";
            if (!allowed) continue;
            let value = setting.value;
            if (setting.key === "space.emailReminder.templateSubject") value = normalizeReminderSubject(value, "space");
            if (setting.key === "space.emailReminder.templateBody") value = normalizeReminderBody(value, "space");
            if (setting.key === "childAccount.emailReminder.templateSubject") value = normalizeReminderSubject(value, "child");
            if (setting.key === "childAccount.emailReminder.templateBody") value = normalizeReminderBody(value, "child");
            if (setting.key === "ui.palette.mode" && value.startsWith("win-")) value = "teal";
            settingInsert.run(setting.key, value, now);
          }
        }
        this.target.db.prepare(`
          INSERT INTO app_meta(key, value) VALUES ('legacy_imported_at', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(now);
        const summary = this.target.summary();
        if (summary.spaces !== expectedSpaces || summary.childSeats !== expectedChildren) {
          throw new Error("导入后的空间或子位置数量与旧版不一致");
        }
        const integrity = String(this.target.db.pragma("integrity_check", { simple: true }));
        const foreignKeys = this.target.db.pragma("foreign_key_check") as unknown[];
        if (integrity !== "ok" || foreignKeys.length) throw new Error("导入后的数据库完整性检查失败");
        return summary;
      })();

      return {
        spaces: importedSummary.spaces,
        motherAccounts: importedSummary.motherAccounts,
        childSeats: importedSummary.childSeats,
        paymentMethods: importedSummary.paymentChannels,
        receipts: receiptCount,
        backupDirectory: preImportBackup.directory,
      };
    } finally {
      source.close();
    }
  }
}
