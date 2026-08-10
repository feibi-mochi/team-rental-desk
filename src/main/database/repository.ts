import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  ArchivedChildSeatView,
  ChildSeatInput,
  ChildSeatView,
  CurrencyView,
  CurrencyInput,
  DashboardSnapshot,
  LocalShortcutView,
  PaymentMethodView,
  ReceiptInput,
  RenewalInput,
  RestoreChildSeatInput,
  SpaceInput,
  SpaceListItem,
  TransactionHistory,
} from "../../shared/contracts.js";
import {
  addCalendarMonthsClamped,
  assertLocalDate,
  classifyExpiry,
  localDateFromInstant,
  localDateNow,
} from "../domain/calendar.js";
import { convertCurrencyMinor, type Quote } from "../domain/money-conversion.js";
import { calculatePlatformFee } from "../domain/money.js";
import {
  childSeatInputSchema,
  paymentMethodInputSchema,
  receiptInputSchema,
  renewalInputSchema,
  spaceInputSchema,
} from "../domain/validation.js";
import type { TeamRentalDatabase } from "./database.js";

type SpaceRow = {
  id: string;
  display_name: string;
  service_kind: "chatgpt" | "codex";
  owner_login: string;
  country_code: string;
  source_currency: string;
  source_cost_minor: number;
  opened_on: string;
  current_cycle_started_on: string;
  renews_on: string;
  renewal_anchor_day: number;
  cycle_months: number;
  mother_seat_kind: "chatgpt" | "codex";
  mother_seat_flexible: number;
  frozen_usd_minor: number | null;
  frozen_cny_minor: number | null;
};

type ChildRow = {
  id: string;
  space_id: string;
  position_number: number;
  seat_kind: "chatgpt" | "codex";
  usage_kind: "rental" | "self_use";
  customer_login: string;
  label: string;
  contact: string;
  joined_on: string;
  charge_currency: string;
  charge_minor: number;
  payment_day: number;
  next_payment_on: string;
  cycle_months: number;
  pending_first_receipt: number;
  customer_revision: number;
  archived_at: string | null;
  archived_by_space: number;
  deleted_at: string | null;
};

type OpenCycleRow = {
  id: string;
  amount_due_minor: number;
  received_minor: number;
};

export class TeamRentalRepository {
  constructor(private readonly database: TeamRentalDatabase) {}

  private soonDays(key: "space.status.soonDays" | "childAccount.status.soonDays"): number {
    const value = Number(this.database.getSetting(key) ?? "5");
    return Number.isInteger(value) && value >= 0 && value <= 90 ? value : 5;
  }

  private quote(code: string): Quote {
    const row = this.database.db.prepare(`
      SELECT u.code, u.decimal_places, q.units_per_usd, q.provider, q.quoted_at
      FROM money_unit u
      JOIN exchange_quote q ON q.code = u.code
      WHERE u.code = ? AND u.enabled = 1 AND u.deleted_at IS NULL
    `).get(code) as
      | {
          code: string;
          decimal_places: number;
          units_per_usd: string;
          provider: string;
          quoted_at: string;
        }
      | undefined;
    if (!row) throw new Error(`${code} 当前没有可用汇率，请先更新汇率`);
    return {
      code: row.code,
      decimalPlaces: row.decimal_places,
      unitsPerUsd: row.units_per_usd,
      provider: row.provider,
      quotedAt: row.quoted_at,
    };
  }

  private convertToCny(amountMinor: number, currency: string): number {
    return convertCurrencyMinor(amountMinor, this.quote(currency), this.quote("CNY"));
  }

  listPaymentMethods(includeArchived = false): PaymentMethodView[] {
    const rows = this.database.db.prepare(`
      SELECT id, name, note, archived_at
      FROM payment_method
      ${includeArchived ? "" : "WHERE archived_at IS NULL"}
      ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE
    `).all() as Array<{ id: string; name: string; note: string; archived_at: string | null }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      note: row.note,
      archived: row.archived_at !== null,
    }));
  }

  savePaymentMethod(raw: { id?: string; name: string; note: string }): string {
    const input = paymentMethodInputSchema.parse(raw);
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const existing = input.id
      ? (this.database.db.prepare("SELECT id FROM payment_method WHERE id = ?").get(input.id) as
          | { id: string }
          | undefined)
      : undefined;
    if (input.id && !existing) throw new Error("支付渠道不存在");
    try {
      this.database.db.prepare(`
        INSERT INTO payment_method(id, name, note, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          note = excluded.note,
          updated_at = excluded.updated_at
      `).run(id, input.name, input.note, now, now);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new Error("已有同名的有效支付渠道");
      throw error;
    }
    return id;
  }

  setPaymentMethodArchived(id: string, archived: boolean): void {
    const existing = this.database.db.prepare("SELECT id, name FROM payment_method WHERE id = ?").get(id) as
      | { id: string; name: string }
      | undefined;
    if (!existing) throw new Error("支付渠道不存在");
    if (!archived) {
      const duplicate = this.database.db.prepare(`
        SELECT id FROM payment_method
        WHERE name = ? COLLATE NOCASE AND archived_at IS NULL AND id <> ?
      `).get(existing.name, id);
      if (duplicate) throw new Error("已有同名的有效支付渠道，无法恢复");
    } else {
      const inUse = this.database.db.prepare(`
        SELECT 1 FROM space_payment_method sp
        JOIN team_space s ON s.id = sp.space_id
        WHERE sp.payment_method_id = ? AND s.archived_at IS NULL AND s.deleted_at IS NULL
        LIMIT 1
      `).get(id);
      if (inUse) throw new Error("该支付渠道仍绑定着有效空间，请先从空间中移除");
    }
    this.database.db.prepare(`
      UPDATE payment_method SET archived_at = ?, updated_at = ? WHERE id = ?
    `).run(archived ? new Date().toISOString() : null, new Date().toISOString(), id);
  }

  deletePaymentMethod(id: string): void {
    this.database.db.transaction(() => {
      const existing = this.database.db.prepare("SELECT archived_at FROM payment_method WHERE id = ?").get(id) as
        | { archived_at: string | null }
        | undefined;
      if (!existing) throw new Error("支付渠道不存在");
      if (!existing.archived_at) throw new Error("请先归档支付渠道，再删除");
      const activeInUse = this.database.db.prepare(`
        SELECT 1
        FROM space_payment_method sp
        JOIN team_space s ON s.id = sp.space_id
        WHERE sp.payment_method_id = ?
          AND s.archived_at IS NULL AND s.deleted_at IS NULL
        LIMIT 1
      `).get(id);
      if (activeInUse) throw new Error("该支付渠道仍绑定着有效空间，不能删除");
      this.database.db.prepare("DELETE FROM space_payment_method WHERE payment_method_id = ?").run(id);
      this.database.db.prepare("DELETE FROM payment_method WHERE id = ?").run(id);
    })();
  }

  listCurrencies(includeDeleted = false): CurrencyView[] {
    const rows = this.database.db.prepare(`
      SELECT u.code, u.name, u.symbol, u.decimal_places, u.enabled,
             q.units_per_usd, q.provider, q.quoted_at
      FROM money_unit u
      LEFT JOIN exchange_quote q ON q.code = u.code
      ${includeDeleted ? "" : "WHERE u.deleted_at IS NULL"}
      ORDER BY u.sort_order, u.code
    `).all() as Array<{
      code: string;
      name: string;
      symbol: string;
      decimal_places: number;
      enabled: number;
      units_per_usd: string | null;
      provider: string | null;
      quoted_at: string | null;
    }>;
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      symbol: row.symbol,
      decimalPlaces: row.decimal_places,
      enabled: Boolean(row.enabled),
      unitsPerUsd: row.units_per_usd,
      provider: row.provider,
      quotedAt: row.quoted_at,
    }));
  }

  saveCurrency(input: CurrencyInput): void {
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    const symbol = input.symbol.trim();
    if (!/^[A-Z0-9]{2,10}$/.test(code)) throw new Error("币种代码只能使用 2 到 10 位大写字母或数字");
    if (!name || !symbol) throw new Error("请填写币种名称和符号");
    if (!Number.isInteger(input.decimalPlaces) || input.decimalPlaces < 0 || input.decimalPlaces > 6) {
      throw new Error("小数位数必须在 0 到 6 之间");
    }
    const existing = this.database.db.prepare("SELECT code, decimal_places, deleted_at FROM money_unit WHERE code = ?").get(code) as
      | { code: string; decimal_places: number; deleted_at: string | null }
      | undefined;
    const activeInUse = (currencyCode: string): boolean => Boolean(this.database.db.prepare(`
      SELECT 1 FROM (
        SELECT source_currency AS code FROM team_space WHERE archived_at IS NULL AND deleted_at IS NULL
        UNION ALL
        SELECT charge_currency AS code FROM child_seat WHERE archived_at IS NULL AND deleted_at IS NULL
      ) WHERE code = ? LIMIT 1
    `).get(currencyCode));
    const referencedAnywhere = (currencyCode: string): boolean => Boolean(this.database.db.prepare(`
      SELECT 1 FROM (
        SELECT source_currency AS code FROM team_space
        UNION ALL
        SELECT charge_currency AS code FROM child_seat
        UNION ALL
        SELECT currency_code AS code FROM seat_billing_cycle
      ) WHERE code = ? LIMIT 1
    `).get(currencyCode));
    if (existing && existing.decimal_places !== input.decimalPlaces && referencedAnywhere(code)) {
      throw new Error("该币种正在使用中，不能修改小数位数");
    }
    if (existing && !input.enabled && activeInUse(code)) {
      throw new Error("该币种正在使用中，不能停用");
    }
    const maxSort = this.database.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM money_unit").get() as { value: number };
    this.database.db.prepare(`
      INSERT INTO money_unit(code, name, symbol, decimal_places, enabled, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        symbol = excluded.symbol,
        decimal_places = excluded.decimal_places,
        enabled = excluded.enabled,
        deleted_at = NULL
    `).run(code, name, symbol, input.decimalPlaces, input.enabled ? 1 : 0, maxSort.value + 1);
  }

  deleteCurrency(rawCode: string): void {
    const code = rawCode.trim().toUpperCase();
    if (code === "USD" || code === "CNY") throw new Error("USD 和 CNY 是记账基准币种，不能删除");
    const existing = this.database.db.prepare("SELECT code FROM money_unit WHERE code = ? AND deleted_at IS NULL").get(code);
    if (!existing) throw new Error("币种不存在或已经删除");
    const activeInUse = this.database.db.prepare(`
      SELECT 1 FROM (
        SELECT source_currency AS code FROM team_space WHERE archived_at IS NULL AND deleted_at IS NULL
        UNION ALL
        SELECT charge_currency AS code FROM child_seat WHERE archived_at IS NULL AND deleted_at IS NULL
      ) WHERE code = ? LIMIT 1
    `).get(code);
    if (activeInUse) throw new Error("该币种仍被有效空间或子位置使用，请先更换币种");
    this.database.db.prepare(`
      UPDATE money_unit SET enabled = 0, deleted_at = ? WHERE code = ?
    `).run(new Date().toISOString(), code);
  }

  listShortcuts(): LocalShortcutView[] {
    const rows = this.database.db.prepare(`
      SELECT id, label, target_path, space_id FROM local_shortcut ORDER BY sort_order, label
    `).all() as Array<{ id: string; label: string; target_path: string; space_id: string | null }>;
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      targetPath: row.target_path,
      spaceId: row.space_id,
      available: existsSync(row.target_path),
    }));
  }

  saveShortcut(input: { id?: string; label: string; targetPath: string; spaceId: string | null }): string {
    const label = input.label.trim();
    const targetPath = input.targetPath.trim();
    if (!label) throw new Error("请填写快捷方式名称");
    if (!targetPath) throw new Error("请选择快捷方式或程序文件");
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    this.database.db.prepare(`
      INSERT INTO local_shortcut(id, label, target_path, space_id, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        target_path = excluded.target_path,
        space_id = excluded.space_id,
        updated_at = excluded.updated_at
    `).run(id, label, targetPath, input.spaceId, now, now);
    return id;
  }

  deleteShortcut(id: string): void {
    const result = this.database.db.prepare("DELETE FROM local_shortcut WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error("快捷方式不存在");
  }

  saveSpace(raw: SpaceInput): string {
    const input = spaceInputSchema.parse(raw);
    assertLocalDate(input.openedOn);
    assertLocalDate(input.currentCycleStartedOn);
    assertLocalDate(input.renewsOn);
    if (input.currentCycleStartedOn < input.openedOn) throw new Error("当前周期开始日不能早于首次开通日");
    if (input.renewsOn <= input.currentCycleStartedOn) throw new Error("到期日必须晚于当前周期开始日");
    const sourceCurrency = this.database.db.prepare(`
      SELECT 1 FROM money_unit WHERE code = ? AND enabled = 1 AND deleted_at IS NULL
    `).get(input.sourceCurrency);
    if (!sourceCurrency) throw new Error(`币种“${input.sourceCurrency}”未启用或已删除`);
    const uniqueMethods = [...new Set(input.paymentMethodIds)];
    if (uniqueMethods.length !== input.paymentMethodIds.length) throw new Error("支付渠道不能重复绑定");
    if (input.defaultPaymentMethodId && !uniqueMethods.includes(input.defaultPaymentMethodId)) {
      throw new Error("默认支付渠道必须包含在已绑定渠道中");
    }
    if (uniqueMethods.length > 0) {
      const placeholders = uniqueMethods.map(() => "?").join(",");
      const archivedCount = (this.database.db.prepare(`
        SELECT COUNT(*) AS count FROM payment_method
        WHERE id IN (${placeholders}) AND archived_at IS NOT NULL
      `).get(...uniqueMethods) as { count: number }).count;
      if (archivedCount > 0) throw new Error("不能绑定已归档的支付渠道");
    }
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();

    this.database.db.transaction(() => {
      if (input.id && !this.database.db.prepare("SELECT id FROM team_space WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL").get(input.id)) {
        throw new Error("空间不存在、已归档或已删除");
      }
      this.database.db.prepare(`
        INSERT INTO team_space(
          id, display_name, service_kind, owner_login, country_code,
          source_currency, source_cost_minor, opened_on, current_cycle_started_on,
          renews_on, renewal_anchor_day, cycle_months,
          archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          service_kind = excluded.service_kind,
          owner_login = excluded.owner_login,
          country_code = excluded.country_code,
          source_currency = excluded.source_currency,
          source_cost_minor = excluded.source_cost_minor,
          opened_on = excluded.opened_on,
          current_cycle_started_on = excluded.current_cycle_started_on,
          renews_on = excluded.renews_on,
          renewal_anchor_day = excluded.renewal_anchor_day,
          cycle_months = excluded.cycle_months,
          updated_at = excluded.updated_at
      `).run(
        id,
        input.displayName,
        input.serviceKind,
        input.ownerLogin,
        input.countryCode,
        input.sourceCurrency,
        input.sourceCostMinor,
        input.openedOn,
        input.currentCycleStartedOn,
        input.renewsOn,
        input.renewalAnchorDay,
        input.cycleMonths,
        now,
        now,
      );
      this.database.db.prepare(`
        INSERT INTO mother_account(id, space_id, login, seat_kind, can_change_seat_kind, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(space_id) DO UPDATE SET
          login = excluded.login,
          seat_kind = excluded.seat_kind,
          can_change_seat_kind = excluded.can_change_seat_kind,
          updated_at = excluded.updated_at
      `).run(`mother:${id}`, id, input.ownerLogin, input.motherSeatKind, input.motherSeatFlexible ? 1 : 0, now, now);
      this.database.db.prepare("DELETE FROM space_payment_method WHERE space_id = ?").run(id);
      const bind = this.database.db.prepare(`
        INSERT INTO space_payment_method(space_id, payment_method_id, is_default, sort_order)
        VALUES (?, ?, ?, ?)
      `);
      uniqueMethods.forEach((methodId, index) => {
        bind.run(id, methodId, methodId === input.defaultPaymentMethodId ? 1 : 0, index);
      });
    })();
    return id;
  }

  archiveSpace(id: string): void {
    const now = new Date().toISOString();
    this.database.db.transaction(() => {
      const result = this.database.db.prepare(`
        UPDATE team_space SET archived_at = ?, updated_at = ?
        WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL
      `).run(now, now, id);
      if (result.changes === 0) throw new Error("空间不存在或已归档");
      this.database.db.prepare(`
        UPDATE child_seat SET archived_at = ?, archived_by_space = 1, updated_at = ?
        WHERE space_id = ? AND archived_at IS NULL AND deleted_at IS NULL
      `).run(now, now, id);
    })();
  }

  unarchiveSpace(id: string): void {
    const now = new Date().toISOString();
    this.database.db.transaction(() => {
      const disabledCurrency = this.database.db.prepare(`
        SELECT code FROM (
          SELECT u.code
          FROM team_space s
          JOIN money_unit u ON u.code = s.source_currency
           WHERE s.id = ? AND s.deleted_at IS NULL AND (u.enabled = 0 OR u.deleted_at IS NOT NULL)
          UNION ALL
          SELECT u.code
          FROM child_seat c
          JOIN money_unit u ON u.code = c.charge_currency
           WHERE c.space_id = ? AND c.archived_by_space = 1 AND c.deleted_at IS NULL
             AND (u.enabled = 0 OR u.deleted_at IS NOT NULL)
        )
        LIMIT 1
      `).get(id, id) as { code: string } | undefined;
      if (disabledCurrency) throw new Error(`请先启用币种“${disabledCurrency.code}”，再恢复这个空间`);
      const archivedMethod = this.database.db.prepare(`
        SELECT p.name FROM space_payment_method sp
        JOIN payment_method p ON p.id = sp.payment_method_id
         WHERE sp.space_id = ? AND p.archived_at IS NOT NULL
        LIMIT 1
      `).get(id) as { name: string } | undefined;
      if (archivedMethod) throw new Error(`请先恢复支付渠道“${archivedMethod.name}”，再恢复这个空间`);
      const positionConflict = this.database.db.prepare(`
        SELECT position_number
        FROM child_seat
        WHERE space_id = ? AND deleted_at IS NULL
          AND (archived_by_space = 1 OR archived_at IS NULL)
        GROUP BY position_number
        HAVING COUNT(*) > 1
        LIMIT 1
      `).get(id) as { position_number: number } | undefined;
      if (positionConflict) {
        throw new Error(`位置 ${positionConflict.position_number} 存在冲突，无法恢复这个空间`);
      }
      const restoredSeatCount = (this.database.db.prepare(`
        SELECT COUNT(*) AS count
        FROM child_seat
        WHERE space_id = ? AND deleted_at IS NULL
          AND (archived_by_space = 1 OR archived_at IS NULL)
      `).get(id) as { count: number }).count;
      if (restoredSeatCount > 2) throw new Error("恢复后会超过 2 个有效子位置，请先处理位置冲突");
      const result = this.database.db.prepare(`
        UPDATE team_space SET archived_at = NULL, updated_at = ?
        WHERE id = ? AND archived_at IS NOT NULL AND deleted_at IS NULL
      `).run(now, id);
      if (result.changes === 0) throw new Error("空间不存在或未归档");
      this.database.db.prepare(`
        UPDATE child_seat SET archived_at = NULL, archived_by_space = 0, updated_at = ?
        WHERE space_id = ? AND archived_by_space = 1 AND deleted_at IS NULL
      `).run(now, id);
    })();
  }

  deleteArchivedSpace(id: string): void {
    const now = new Date().toISOString();
    this.database.db.transaction(() => {
      const existing = this.database.db.prepare(`
        SELECT id FROM team_space
        WHERE id = ? AND archived_at IS NOT NULL AND deleted_at IS NULL
      `).get(id);
      if (!existing) throw new Error("空间不存在、未归档或已经删除");

      const independentlyArchivedPartial = this.database.db.prepare(`
        SELECT c.id
        FROM child_seat c
        JOIN seat_billing_cycle b
          ON b.child_seat_id = c.id
         AND b.customer_revision = c.customer_revision
         AND b.closed_at IS NULL
        LEFT JOIN receipt r ON r.billing_cycle_id = b.id AND r.voided_at IS NULL
        WHERE c.space_id = ?
          AND c.archived_at IS NOT NULL
          AND c.archived_by_space = 0
          AND c.deleted_at IS NULL
        GROUP BY c.id, b.id, b.amount_due_minor
        HAVING COALESCE(SUM(r.gross_minor), 0) > 0
           AND COALESCE(SUM(r.gross_minor), 0) < b.amount_due_minor
        LIMIT 1
      `).get(id);
      if (independentlyArchivedPartial) {
        throw new Error("该母空间下有独立归档且尚未结清的子位置，请先恢复到原位置并处理账期");
      }

      this.database.db.prepare(`
        UPDATE team_space SET deleted_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, id);
      this.database.db.prepare(`
        UPDATE child_seat SET deleted_at = ?, updated_at = ?
        WHERE space_id = ? AND archived_by_space = 1 AND deleted_at IS NULL
      `).run(now, now, id);
      this.database.db.prepare(`
        UPDATE local_shortcut SET space_id = NULL, updated_at = ? WHERE space_id = ?
      `).run(now, id);
      this.database.db.prepare("DELETE FROM space_payment_method WHERE space_id = ?").run(id);
    })();
  }

  saveChildSeat(raw: ChildSeatInput): string {
    const input = childSeatInputSchema.parse(raw);
    assertLocalDate(input.joinedOn);
    assertLocalDate(input.nextPaymentOn);
    if (input.nextPaymentOn <= input.joinedOn) throw new Error("下一付款日必须晚于加入日期");
    const targetSpace = this.database.db.prepare(`
      SELECT id FROM team_space
      WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL
    `).get(input.spaceId);
    if (!targetSpace) throw new Error("目标母空间不存在、已归档或已删除");
    const chargeCurrency = this.database.db.prepare(`
      SELECT 1 FROM money_unit WHERE code = ? AND enabled = 1 AND deleted_at IS NULL
    `).get(input.chargeCurrency);
    if (!chargeCurrency) throw new Error(`币种“${input.chargeCurrency}”未启用或已删除`);

    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const existing = input.id
      ? (this.database.db.prepare(`
          SELECT space_id, position_number, customer_login, customer_revision, pending_first_receipt,
                 usage_kind, charge_currency, charge_minor, payment_day,
                 next_payment_on, cycle_months, archived_at, deleted_at
          FROM child_seat WHERE id = ?
        `).get(id) as
          | {
              space_id: string;
              position_number: number;
              customer_login: string;
              customer_revision: number;
              pending_first_receipt: number;
              usage_kind: "rental" | "self_use";
              charge_currency: string;
              charge_minor: number;
              payment_day: number;
              next_payment_on: string;
              cycle_months: number;
              archived_at: string | null;
              deleted_at: string | null;
            }
          | undefined)
      : undefined;
    if (input.id && !existing) throw new Error("子位置不存在");
    if (existing?.deleted_at) throw new Error("子位置已经删除，不能编辑");
    if (existing?.archived_at) throw new Error("子位置已归档，请从子位置归档中恢复");
    if (existing && existing.space_id !== input.spaceId) {
      throw new Error("不能通过编辑把子位置移到其他母空间，请先归档后再指定母空间恢复");
    }
    if (!existing) {
      const activeSeatCount = (this.database.db.prepare(`
        SELECT COUNT(*) AS count FROM child_seat
        WHERE space_id = ? AND archived_at IS NULL AND deleted_at IS NULL
      `).get(input.spaceId) as { count: number }).count;
      if (activeSeatCount >= 2) throw new Error("每个母号最多只能保留 2 个子位置");
    }
    const customerChanged = Boolean(existing && existing.customer_login !== input.customerLogin);
    const becameRental = Boolean(existing && existing.usage_kind === "self_use" && input.usageKind === "rental");
    if (existing && customerChanged) {
      const openCycle = this.currentOpenCycle(id, existing.customer_revision);
      if (openCycle && openCycle.received_minor > 0) {
        throw new Error("原客户还有部分收款，请先在账务流水中撤销该笔收款，或先收齐后再更换客户");
      }
    }
    const revision = existing ? existing.customer_revision + (customerChanged || becameRental ? 1 : 0) : 1;
    const pendingFirst =
      input.usageKind === "self_use"
        ? 0
        : customerChanged || becameRental || !existing
          ? 1
          : existing.pending_first_receipt;
    if (existing && !customerChanged) {
      const openCycle = this.currentOpenCycle(id, existing.customer_revision);
      const billingChanged =
        existing.position_number !== input.positionNumber ||
        existing.usage_kind !== input.usageKind ||
        existing.charge_currency !== input.chargeCurrency ||
        existing.charge_minor !== input.chargeMinor ||
        existing.payment_day !== input.paymentDay ||
        existing.next_payment_on !== input.nextPaymentOn ||
        existing.cycle_months !== input.cycleMonths;
      if (openCycle && openCycle.received_minor > 0 && billingChanged) {
        throw new Error("这个账期已有部分收款，请先收齐；若已更换客户，请同时修改邮箱/登录名");
      }
    }
    try {
      this.database.db.prepare(`
        INSERT INTO child_seat(
          id, space_id, position_number, seat_kind, usage_kind, customer_login, label,
          contact, joined_on, charge_currency, charge_minor, payment_day,
          next_payment_on, cycle_months, pending_first_receipt, customer_revision,
          archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          space_id = excluded.space_id,
          position_number = excluded.position_number,
          seat_kind = excluded.seat_kind,
          usage_kind = excluded.usage_kind,
          customer_login = excluded.customer_login,
          label = excluded.label,
          contact = excluded.contact,
          joined_on = excluded.joined_on,
          charge_currency = excluded.charge_currency,
          charge_minor = excluded.charge_minor,
          payment_day = excluded.payment_day,
          next_payment_on = excluded.next_payment_on,
          cycle_months = excluded.cycle_months,
          pending_first_receipt = excluded.pending_first_receipt,
          customer_revision = excluded.customer_revision,
          updated_at = excluded.updated_at
      `).run(
        id,
        input.spaceId,
        input.positionNumber,
        input.seatKind,
        input.usageKind,
        input.customerLogin,
        input.label,
        input.contact,
        input.joinedOn,
        input.chargeCurrency,
        input.chargeMinor,
        input.paymentDay,
        input.nextPaymentOn,
        input.cycleMonths,
        pendingFirst,
        revision,
        now,
        now,
      );
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new Error("这个空间已有相同的位置号");
      throw error;
    }
    return id;
  }

  archiveChildSeat(id: string): void {
    const result = this.database.db.prepare(`
      UPDATE child_seat SET archived_at = ?, archived_by_space = 0, updated_at = ?
      WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM team_space s
          WHERE s.id = child_seat.space_id AND s.archived_at IS NULL AND s.deleted_at IS NULL
        )
    `).run(new Date().toISOString(), new Date().toISOString(), id);
    if (result.changes === 0) throw new Error("子位置不存在、已归档、已删除或母空间不可用");
  }

  listArchivedChildSeats(today = localDateNow()): ArchivedChildSeatView[] {
    const rows = this.database.db.prepare(`
      SELECT c.*, COALESCE(s.display_name, '原母空间已删除') AS original_space_name
      FROM child_seat c
      LEFT JOIN team_space s ON s.id = c.space_id
      WHERE c.archived_at IS NOT NULL
        AND c.archived_by_space = 0
        AND c.deleted_at IS NULL
      ORDER BY c.archived_at DESC, original_space_name COLLATE NOCASE, c.position_number
    `).all() as Array<ChildRow & { original_space_name: string; archived_at: string }>;
    return rows.map((row) => ({
      ...this.childView(row, today),
      originalSpaceId: row.space_id,
      originalSpaceName: row.original_space_name,
      archivedAt: row.archived_at,
    }));
  }

  restoreChildSeat(input: RestoreChildSeatInput): void {
    const childSeatId = input?.childSeatId?.trim();
    const targetSpaceId = input?.targetSpaceId?.trim();
    const positionNumber = Number(input?.positionNumber);
    if (!childSeatId || childSeatId.length > 100 || !targetSpaceId || targetSpaceId.length > 100) {
      throw new Error("恢复参数无效");
    }
    if (positionNumber !== 1 && positionNumber !== 2) throw new Error("子位置号只能是 1 或 2");

    this.database.db.transaction(() => {
      const child = this.database.db.prepare(`
        SELECT * FROM child_seat
        WHERE id = ? AND archived_at IS NOT NULL AND archived_by_space = 0 AND deleted_at IS NULL
      `).get(childSeatId) as ChildRow | undefined;
      if (!child) throw new Error("独立归档的子位置不存在、已恢复或已经删除");

      const target = this.database.db.prepare(`
        SELECT id FROM team_space
        WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL
      `).get(targetSpaceId);
      if (!target) throw new Error("目标母空间不存在、已归档或已删除");

      const currency = this.database.db.prepare(`
        SELECT 1 FROM money_unit WHERE code = ? AND enabled = 1 AND deleted_at IS NULL
      `).get(child.charge_currency);
      if (!currency) throw new Error(`请先启用币种“${child.charge_currency}”，再恢复这个子位置`);

      const moved = child.space_id !== targetSpaceId || child.position_number !== positionNumber;
      if (moved) {
        const openCycle = this.currentOpenCycle(child.id, child.customer_revision);
        if (openCycle && openCycle.received_minor > 0 && openCycle.received_minor < openCycle.amount_due_minor) {
          throw new Error("这个子位置还有部分收款，只能先恢复到原母空间的原位置并处理账期");
        }
      }

      const activeSeatCount = (this.database.db.prepare(`
        SELECT COUNT(*) AS count FROM child_seat
        WHERE space_id = ? AND archived_at IS NULL AND deleted_at IS NULL
      `).get(targetSpaceId) as { count: number }).count;
      if (activeSeatCount >= 2) throw new Error("目标母空间已经没有空余子位置");
      const occupied = this.database.db.prepare(`
        SELECT 1 FROM child_seat
        WHERE space_id = ? AND position_number = ? AND archived_at IS NULL AND deleted_at IS NULL
      `).get(targetSpaceId, positionNumber);
      if (occupied) throw new Error(`目标母空间的位置 ${positionNumber} 已被占用`);

      const result = this.database.db.prepare(`
        UPDATE child_seat
        SET space_id = ?, position_number = ?, archived_at = NULL,
            archived_by_space = 0, updated_at = ?
        WHERE id = ? AND archived_at IS NOT NULL AND archived_by_space = 0 AND deleted_at IS NULL
      `).run(targetSpaceId, positionNumber, new Date().toISOString(), child.id);
      if (result.changes !== 1) throw new Error("子位置恢复失败，请刷新后重试");
    })();
  }

  deleteArchivedChildSeat(id: string): void {
    const now = new Date().toISOString();
    const result = this.database.db.prepare(`
      UPDATE child_seat SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND archived_at IS NOT NULL AND archived_by_space = 0 AND deleted_at IS NULL
    `).run(now, now, id);
    if (result.changes === 0) throw new Error("独立归档的子位置不存在、未归档或已经删除");
  }

  private currentOpenCycle(childSeatId: string, revision: number): OpenCycleRow | null {
    return (this.database.db.prepare(`
      SELECT c.id, c.amount_due_minor, COALESCE(SUM(r.gross_minor), 0) AS received_minor
      FROM seat_billing_cycle c
      LEFT JOIN receipt r ON r.billing_cycle_id = c.id AND r.voided_at IS NULL
      WHERE c.child_seat_id = ? AND c.customer_revision = ? AND c.closed_at IS NULL
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 1
    `).get(childSeatId, revision) as OpenCycleRow | undefined) ?? null;
  }

  recordReceipt(raw: ReceiptInput): void {
    const input = receiptInputSchema.parse(raw);
    if (input.operationId && this.database.db.prepare("SELECT 1 FROM receipt WHERE operation_id = ?").get(input.operationId)) return;
    const child = this.database.db.prepare(`
      SELECT c.*, s.display_name AS space_name
      FROM child_seat c
      JOIN team_space s ON s.id = c.space_id
      WHERE c.id = ?
        AND c.archived_at IS NULL AND c.deleted_at IS NULL
        AND s.archived_at IS NULL AND s.deleted_at IS NULL
    `).get(input.childSeatId) as (ChildRow & { space_name: string }) | undefined;
    if (!child) throw new Error("子位置不存在");
    if (child.usage_kind === "self_use" || child.charge_minor <= 0) throw new Error("自用位置无需记账");
    if (localDateFromInstant(input.receivedAt) < child.joined_on) throw new Error("收款时间不能早于客户加入日期");

    this.database.db.transaction(() => {
      if (input.operationId && this.database.db.prepare("SELECT 1 FROM receipt WHERE operation_id = ?").get(input.operationId)) return;
      let cycle = this.currentOpenCycle(child.id, child.customer_revision);
      const now = new Date().toISOString();
      const isInitial = Boolean(child.pending_first_receipt);
      if (!cycle) {
        const cycleId = randomUUID();
        const startsOn = isInitial ? child.joined_on : child.next_payment_on;
        const dueOn = startsOn;
        const coverageEndsOn = isInitial
          ? child.next_payment_on
          : addCalendarMonthsClamped(child.next_payment_on, child.cycle_months, child.payment_day);
        this.database.db.prepare(`
          INSERT INTO seat_billing_cycle(
            id, child_seat_id, customer_revision, customer_login_snapshot,
            space_id_snapshot, space_name_snapshot, position_number_snapshot,
            cycle_kind, starts_on, due_on, coverage_ends_on,
            amount_due_minor, currency_code, closed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `).run(
          cycleId,
          child.id,
          child.customer_revision,
          child.customer_login,
          child.space_id,
          child.space_name,
          child.position_number,
          isInitial ? "initial" : "renewal",
          startsOn,
          dueOn,
          coverageEndsOn,
          child.charge_minor,
          child.charge_currency,
          now,
        );
        cycle = { id: cycleId, amount_due_minor: child.charge_minor, received_minor: 0 };
      }
      const remaining = cycle.amount_due_minor - cycle.received_minor;
      if (input.grossMinor > remaining) {
        throw new Error(`收款超过剩余应收金额，最多只能记录 ${remaining} 个最小货币单位`);
      }
      const { feeMinor, netMinor } = calculatePlatformFee(input.grossMinor, input.feeBasisPoints);
      const sourceQuote = this.quote(child.charge_currency);
      const usdQuote = this.quote("USD");
      const cnyQuote = this.quote("CNY");
      const grossUsd = convertCurrencyMinor(input.grossMinor, sourceQuote, usdQuote);
      const grossCny = convertCurrencyMinor(input.grossMinor, sourceQuote, cnyQuote);
      const netUsd = convertCurrencyMinor(netMinor, sourceQuote, usdQuote);
      const netCny = convertCurrencyMinor(netMinor, sourceQuote, cnyQuote);
      this.database.db.prepare(`
        INSERT INTO receipt(
          id, operation_id, billing_cycle_id, gross_minor, fee_basis_points, fee_minor, net_minor,
          gross_usd_minor, gross_cny_minor, net_usd_minor, net_cny_minor,
          fx_provider, fx_quoted_at, received_at, received_local_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        input.operationId ?? null,
        cycle.id,
        input.grossMinor,
        input.feeBasisPoints,
        feeMinor,
        netMinor,
        grossUsd,
        grossCny,
        netUsd,
        netCny,
        `${sourceQuote.provider}/${cnyQuote.provider}`,
        [sourceQuote.quotedAt, cnyQuote.quotedAt].sort().at(0),
        input.receivedAt,
        localDateFromInstant(input.receivedAt),
        now,
      );
      if (input.grossMinor === remaining) {
        this.database.db.prepare("UPDATE seat_billing_cycle SET closed_at = ? WHERE id = ?").run(now, cycle.id);
        if (isInitial) {
          this.database.db.prepare(`
            UPDATE child_seat SET pending_first_receipt = 0, updated_at = ? WHERE id = ?
          `).run(now, child.id);
        } else {
          const next = addCalendarMonthsClamped(
            child.next_payment_on,
            child.cycle_months,
            child.payment_day,
          );
          this.database.db.prepare(`
            UPDATE child_seat SET next_payment_on = ?, updated_at = ? WHERE id = ?
          `).run(next, now, child.id);
        }
      }
    })();
  }

  renewSpace(raw: RenewalInput): void {
    const input = renewalInputSchema.parse(raw);
    if (input.operationId && this.database.db.prepare("SELECT 1 FROM renewal_event WHERE operation_id = ?").get(input.operationId)) return;
    const space = this.database.db.prepare(`
      SELECT id, opened_on, current_cycle_started_on, renews_on, renewal_anchor_day, cycle_months
      FROM team_space WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL
    `).get(input.spaceId) as
      | { id: string; opened_on: string; current_cycle_started_on: string; renews_on: string; renewal_anchor_day: number; cycle_months: number }
      | undefined;
    if (!space) throw new Error("空间不存在");
    if (localDateFromInstant(input.paidAt) < space.opened_on) throw new Error("支付时间不能早于空间首次开通日");
    const cnyQuote = this.quote("CNY");
    const usdQuote = this.quote("USD");
    const frozenCny = convertCurrencyMinor(input.frozenUsdMinor, usdQuote, cnyQuote);
    const next = addCalendarMonthsClamped(
      space.renews_on,
      space.cycle_months,
      space.renewal_anchor_day,
    );
    const now = new Date().toISOString();
    this.database.db.transaction(() => {
      if (input.operationId && this.database.db.prepare("SELECT 1 FROM renewal_event WHERE operation_id = ?").get(input.operationId)) return;
      this.database.db.prepare(`
        INSERT INTO renewal_event(
          id, operation_id, space_id, event_kind, previous_renews_on, previous_cycle_started_on, next_renews_on,
          frozen_usd_minor, frozen_cny_minor, cny_per_usd, paid_at,
          paid_local_date, created_at
        ) VALUES (?, ?, ?, 'renewal', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        input.operationId ?? null,
        space.id,
        space.renews_on,
        space.current_cycle_started_on,
        next,
        input.frozenUsdMinor,
        frozenCny,
        cnyQuote.unitsPerUsd,
        input.paidAt,
        localDateFromInstant(input.paidAt),
        now,
      );
      this.database.db.prepare(`
        UPDATE team_space
        SET current_cycle_started_on = ?, renews_on = ?, updated_at = ?
        WHERE id = ?
      `).run(space.renews_on, next, now, space.id);
    })();
  }

  listTransactions(): TransactionHistory {
    const receipts = this.database.db.prepare(`
      SELECT r.id, r.gross_minor, r.fee_basis_points, r.net_minor, r.received_at,
             r.voided_at, r.void_reason, b.currency_code, b.child_seat_id,
             COALESCE(b.position_number_snapshot, c.position_number) AS position_number,
             COALESCE(b.customer_login_snapshot, c.customer_login) AS customer_login,
             COALESCE(b.space_id_snapshot, c.space_id) AS space_id,
             COALESCE(b.space_name_snapshot, original_space.display_name, s.display_name) AS display_name,
             CASE WHEN r.voided_at IS NULL AND r.id NOT LIKE 'legacy:%'
                AND b.customer_revision = c.customer_revision
                AND b.amount_due_minor = c.charge_minor
                AND b.currency_code = c.charge_currency
                AND c.archived_at IS NULL AND c.deleted_at IS NULL
                AND s.archived_at IS NULL AND s.deleted_at IS NULL
                AND original_space.id IS NOT NULL
                AND original_space.archived_at IS NULL AND original_space.deleted_at IS NULL
                AND COALESCE(b.space_id_snapshot, c.space_id) = c.space_id
                AND COALESCE(b.position_number_snapshot, c.position_number) = c.position_number
                AND (b.cycle_kind = 'initial' OR b.closed_at IS NULL OR c.next_payment_on = b.coverage_ends_on)
               AND NOT EXISTS (
               SELECT 1 FROM receipt later
               JOIN seat_billing_cycle later_cycle ON later_cycle.id = later.billing_cycle_id
               WHERE later_cycle.child_seat_id = b.child_seat_id
                 AND later.voided_at IS NULL
                 AND (later.created_at > r.created_at OR (later.created_at = r.created_at AND later.rowid > r.rowid))
             ) THEN 1 ELSE 0 END AS can_void
      FROM receipt r
       JOIN seat_billing_cycle b ON b.id = r.billing_cycle_id
       JOIN child_seat c ON c.id = b.child_seat_id
       JOIN team_space s ON s.id = c.space_id
      LEFT JOIN team_space original_space ON original_space.id = COALESCE(b.space_id_snapshot, c.space_id)
      ORDER BY r.created_at DESC, r.rowid DESC
    `).all() as Array<{
      id: string; gross_minor: number; fee_basis_points: 0 | 60 | 160; net_minor: number;
      received_at: string; voided_at: string | null; void_reason: string; currency_code: string;
      child_seat_id: string; position_number: number; customer_login: string; space_id: string;
      display_name: string; can_void: number;
    }>;
    const renewals = this.database.db.prepare(`
      SELECT r.id, r.space_id, s.display_name, r.previous_renews_on, r.next_renews_on,
             r.frozen_usd_minor, r.frozen_cny_minor, r.paid_at, r.voided_at, r.void_reason,
              CASE WHEN r.voided_at IS NULL AND r.previous_cycle_started_on IS NOT NULL
                AND s.renews_on = r.next_renews_on
                AND s.archived_at IS NULL AND s.deleted_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM renewal_event later
                 WHERE later.space_id = r.space_id AND later.event_kind = 'renewal'
                   AND later.voided_at IS NULL
                   AND (later.created_at > r.created_at OR (later.created_at = r.created_at AND later.rowid > r.rowid))
               ) THEN 1 ELSE 0 END AS can_void
      FROM renewal_event r
      JOIN team_space s ON s.id = r.space_id
      WHERE r.event_kind = 'renewal'
      ORDER BY r.created_at DESC, r.rowid DESC
    `).all() as Array<{
      id: string; space_id: string; display_name: string; previous_renews_on: string; next_renews_on: string;
      frozen_usd_minor: number; frozen_cny_minor: number; paid_at: string; voided_at: string | null;
      void_reason: string; can_void: number;
    }>;
    return {
      receipts: receipts.map((row) => ({
        id: row.id,
        spaceId: row.space_id,
        spaceName: row.display_name,
        childSeatId: row.child_seat_id,
        childLabel: `${row.customer_login} · 位置 ${row.position_number}`,
        gross: { minor: row.gross_minor, currency: row.currency_code },
        feeBasisPoints: row.fee_basis_points,
        net: { minor: row.net_minor, currency: row.currency_code },
        receivedAt: row.received_at,
        voidedAt: row.voided_at,
        voidReason: row.void_reason,
        canVoid: Boolean(row.can_void),
      })),
      renewals: renewals.map((row) => ({
        id: row.id,
        spaceId: row.space_id,
        spaceName: row.display_name,
        previousRenewsOn: row.previous_renews_on,
        nextRenewsOn: row.next_renews_on,
        frozenUsdMinor: row.frozen_usd_minor,
        frozenCnyMinor: row.frozen_cny_minor,
        paidAt: row.paid_at,
        voidedAt: row.voided_at,
        voidReason: row.void_reason,
        canVoid: Boolean(row.can_void),
      })),
    };
  }

  voidReceipt(id: string, rawReason: string): void {
    const reason = rawReason.trim();
    if (reason.length < 2 || reason.length > 200) throw new Error("请填写 2 到 200 个字的撤销原因");
    this.database.db.transaction(() => {
      const row = this.database.db.prepare(`
        SELECT r.id, r.created_at, r.voided_at, b.id AS cycle_id, b.child_seat_id,
               b.customer_revision, b.cycle_kind, b.due_on, b.coverage_ends_on,
               b.amount_due_minor, b.currency_code, b.closed_at,
               c.customer_revision AS current_customer_revision,
               c.charge_minor AS current_charge_minor,
               c.charge_currency AS current_charge_currency,
               c.next_payment_on AS current_next_payment_on,
               c.space_id AS current_space_id, c.position_number AS current_position_number,
               c.archived_at AS child_archived_at, c.deleted_at AS child_deleted_at,
               s.archived_at AS space_archived_at, s.deleted_at AS space_deleted_at,
               COALESCE(b.space_id_snapshot, c.space_id) AS billed_space_id,
               COALESCE(b.position_number_snapshot, c.position_number) AS billed_position_number,
               original_space.id AS original_space_id,
               original_space.archived_at AS original_space_archived_at,
               original_space.deleted_at AS original_space_deleted_at
        FROM receipt r
        JOIN seat_billing_cycle b ON b.id = r.billing_cycle_id
        JOIN child_seat c ON c.id = b.child_seat_id
        JOIN team_space s ON s.id = c.space_id
        LEFT JOIN team_space original_space ON original_space.id = COALESCE(b.space_id_snapshot, c.space_id)
        WHERE r.id = ?
      `).get(id) as {
        id: string; created_at: string; voided_at: string | null; cycle_id: string; child_seat_id: string;
        customer_revision: number; cycle_kind: "initial" | "renewal"; due_on: string;
        coverage_ends_on: string; amount_due_minor: number; currency_code: string; closed_at: string | null;
        current_customer_revision: number; current_charge_minor: number; current_charge_currency: string;
        current_next_payment_on: string;
        current_space_id: string; current_position_number: number;
        child_archived_at: string | null; child_deleted_at: string | null;
        space_archived_at: string | null; space_deleted_at: string | null;
        billed_space_id: string; billed_position_number: number; original_space_id: string | null;
        original_space_archived_at: string | null; original_space_deleted_at: string | null;
      } | undefined;
      if (!row) throw new Error("收款记录不存在");
      if (row.voided_at) throw new Error("这笔收款已经撤销");
      if (row.id.startsWith("legacy:")) throw new Error("旧版导入的历史收款不能自动撤销");
      const inactiveOrMoved =
        row.child_archived_at !== null ||
        row.child_deleted_at !== null ||
        row.space_archived_at !== null ||
        row.space_deleted_at !== null ||
        row.original_space_id === null ||
        row.original_space_archived_at !== null ||
        row.original_space_deleted_at !== null ||
        row.billed_space_id !== row.current_space_id ||
        row.billed_position_number !== row.current_position_number;
      if (inactiveOrMoved) {
        throw new Error("这笔收款所属的空间或子位置已归档、删除或移动，不能自动撤销");
      }
      const stateChanged =
        row.customer_revision !== row.current_customer_revision ||
        row.amount_due_minor !== row.current_charge_minor ||
        row.currency_code !== row.current_charge_currency ||
        (row.cycle_kind === "renewal" && row.closed_at !== null && row.coverage_ends_on !== row.current_next_payment_on);
      if (stateChanged) throw new Error("客户或账期资料已在收款后修改，不能自动撤销这笔旧记录");
      const later = this.database.db.prepare(`
        SELECT 1 FROM receipt later
        JOIN seat_billing_cycle later_cycle ON later_cycle.id = later.billing_cycle_id
        WHERE later_cycle.child_seat_id = ? AND later.voided_at IS NULL
          AND (later.created_at > ? OR (later.created_at = ? AND later.rowid > (SELECT rowid FROM receipt WHERE id = ?)))
        LIMIT 1
      `).get(row.child_seat_id, row.created_at, row.created_at, row.id);
      if (later) throw new Error("只能从该子位置最后一笔有效收款开始撤销");
      const now = new Date().toISOString();
      this.database.db.prepare("UPDATE receipt SET voided_at = ?, void_reason = ? WHERE id = ?").run(now, reason, id);
      const received = (this.database.db.prepare(`
        SELECT COALESCE(SUM(gross_minor), 0) AS value FROM receipt
        WHERE billing_cycle_id = ? AND voided_at IS NULL
      `).get(row.cycle_id) as { value: number }).value;
      if (received < row.amount_due_minor) {
        this.database.db.prepare("UPDATE seat_billing_cycle SET closed_at = NULL WHERE id = ?").run(row.cycle_id);
        if (row.cycle_kind === "initial") {
          this.database.db.prepare("UPDATE child_seat SET pending_first_receipt = 1, updated_at = ? WHERE id = ?").run(now, row.child_seat_id);
        } else if (row.closed_at) {
          this.database.db.prepare("UPDATE child_seat SET next_payment_on = ?, updated_at = ? WHERE id = ?").run(row.due_on, now, row.child_seat_id);
        }
      }
    })();
  }

  voidRenewal(id: string, rawReason: string): void {
    const reason = rawReason.trim();
    if (reason.length < 2 || reason.length > 200) throw new Error("请填写 2 到 200 个字的撤销原因");
    this.database.db.transaction(() => {
      const row = this.database.db.prepare(`
        SELECT r.*, s.renews_on AS current_renews_on,
               s.archived_at AS space_archived_at, s.deleted_at AS space_deleted_at
        FROM renewal_event r JOIN team_space s ON s.id = r.space_id
        WHERE r.id = ? AND r.event_kind = 'renewal'
      `).get(id) as {
        id: string; space_id: string; created_at: string; voided_at: string | null;
        previous_renews_on: string; previous_cycle_started_on: string | null;
        next_renews_on: string; current_renews_on: string;
        space_archived_at: string | null; space_deleted_at: string | null;
      } | undefined;
      if (!row) throw new Error("续费记录不存在");
      if (row.voided_at) throw new Error("这笔续费已经撤销");
      if (!row.previous_cycle_started_on) throw new Error("旧版续费记录缺少恢复信息，不能自动撤销");
      if (row.space_archived_at !== null || row.space_deleted_at !== null) {
        throw new Error("这笔续费所属空间已归档或删除，不能自动撤销");
      }
      const later = this.database.db.prepare(`
        SELECT 1 FROM renewal_event
        WHERE space_id = ? AND event_kind = 'renewal' AND voided_at IS NULL
          AND (created_at > ? OR (created_at = ? AND rowid > (SELECT rowid FROM renewal_event WHERE id = ?)))
        LIMIT 1
      `).get(row.space_id, row.created_at, row.created_at, row.id);
      if (later || row.current_renews_on !== row.next_renews_on) throw new Error("只能撤销该空间最后一次有效续费");
      const now = new Date().toISOString();
      this.database.db.prepare("UPDATE renewal_event SET voided_at = ?, void_reason = ? WHERE id = ?").run(now, reason, id);
      this.database.db.prepare(`
        UPDATE team_space SET current_cycle_started_on = ?, renews_on = ?, updated_at = ? WHERE id = ?
      `).run(row.previous_cycle_started_on, row.previous_renews_on, now, row.space_id);
    })();
  }

  private childView(row: ChildRow, today: string): ChildSeatView {
    const cycle = this.currentOpenCycle(row.id, row.customer_revision);
    const expiryStatus = classifyExpiry(row.next_payment_on, today, this.soonDays("childAccount.status.soonDays"));
    const collectionStatus = row.usage_kind === "self_use"
      ? "none"
      : cycle && cycle.received_minor > 0
        ? "partial"
        : row.pending_first_receipt
          ? "new_customer"
          : expiryStatus === "normal"
            ? "none"
            : "pending";
    return {
      id: row.id,
      spaceId: row.space_id,
      positionNumber: row.position_number,
      seatKind: row.seat_kind,
      usageKind: row.usage_kind,
      customerLogin: row.customer_login,
      label: row.label,
      contact: row.contact,
      joinedOn: row.joined_on,
      charge: { minor: row.charge_minor, currency: row.charge_currency },
      paymentDay: row.payment_day,
      nextPaymentOn: row.next_payment_on,
      cycleMonths: row.cycle_months,
      pendingFirstReceipt: Boolean(row.pending_first_receipt),
      expiryStatus,
      collectionStatus,
      receivedMinor: cycle?.received_minor ?? 0,
      remainingMinor: Math.max(0, (cycle?.amount_due_minor ?? row.charge_minor) - (cycle?.received_minor ?? 0)),
    };
  }

  private childViews(spaceId: string, today: string, includeArchived = false): ChildSeatView[] {
    const rows = this.database.db.prepare(`
      SELECT * FROM child_seat
      WHERE space_id = ? AND deleted_at IS NULL
        ${includeArchived
          ? "AND archived_at IS NOT NULL AND archived_by_space = 1"
          : "AND archived_at IS NULL"}
      ORDER BY position_number
    `).all(spaceId) as ChildRow[];
    return rows.map((row) => this.childView(row, today));
  }

  private spacesQuery(where: string, includeArchivedChildren: boolean, today: string): SpaceListItem[] {
    const rows = this.database.db.prepare(`
      SELECT s.*, m.seat_kind AS mother_seat_kind,
        m.can_change_seat_kind AS mother_seat_flexible,
        (SELECT frozen_usd_minor FROM renewal_event r WHERE r.space_id = s.id AND r.voided_at IS NULL ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS frozen_usd_minor,
        (SELECT frozen_cny_minor FROM renewal_event r WHERE r.space_id = s.id AND r.voided_at IS NULL ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS frozen_cny_minor
      FROM team_space s
      JOIN mother_account m ON m.space_id = s.id
      WHERE ${where}
      ORDER BY s.renews_on, s.display_name COLLATE NOCASE
    `).all() as SpaceRow[];
    const methodStatement = this.database.db.prepare(`
      SELECT p.id, p.name, p.note, p.archived_at, sp.is_default
      FROM space_payment_method sp
      JOIN payment_method p ON p.id = sp.payment_method_id
      WHERE sp.space_id = ?
      ORDER BY sp.sort_order
    `);
    return rows.map((row) => {
      const methods = methodStatement.all(row.id) as Array<{
        id: string;
        name: string;
        note: string;
        archived_at: string | null;
        is_default: number;
      }>;
      return {
        id: row.id,
        displayName: row.display_name,
        serviceKind: row.service_kind,
        ownerLogin: row.owner_login,
        countryCode: row.country_code,
        sourceCost: { minor: row.source_cost_minor, currency: row.source_currency },
        sourceCostUsdMinor: row.frozen_usd_minor,
        sourceCostCnyMinor: row.frozen_cny_minor,
        openedOn: row.opened_on,
        currentCycleStartedOn: row.current_cycle_started_on,
        renewsOn: row.renews_on,
        renewalAnchorDay: row.renewal_anchor_day,
        cycleMonths: row.cycle_months,
        expiryStatus: classifyExpiry(row.renews_on, today, this.soonDays("space.status.soonDays")),
        motherSeatKind: row.mother_seat_kind,
        motherSeatFlexible: Boolean(row.mother_seat_flexible),
        paymentMethods: methods.map((method) => ({
          id: method.id,
          name: method.name,
          note: method.note,
          archived: method.archived_at !== null,
          isDefault: Boolean(method.is_default),
        })),
        childSeats: this.childViews(row.id, today, includeArchivedChildren),
      };
    });
  }

  listSpaces(today = localDateNow()): SpaceListItem[] {
    return this.spacesQuery("s.archived_at IS NULL AND s.deleted_at IS NULL", false, today);
  }

  listArchivedSpaces(today = localDateNow()): SpaceListItem[] {
    return this.spacesQuery("s.archived_at IS NOT NULL AND s.deleted_at IS NULL", true, today);
  }

  dashboard(today = localDateNow()): DashboardSnapshot {
    const spaces = this.listSpaces(today);
    const children = spaces.flatMap((space) => space.childSeats).filter((seat) => seat.usageKind === "rental");
    const currentMonth = today.slice(0, 7);
    const receiptTotals = this.database.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN received_local_date LIKE ? THEN gross_cny_minor ELSE 0 END), 0) AS month_gross,
        COALESCE(SUM(CASE WHEN received_local_date LIKE ? THEN net_cny_minor ELSE 0 END), 0) AS month_net,
        COALESCE(SUM(net_cny_minor), 0) AS lifetime_net
      FROM receipt
      WHERE voided_at IS NULL
    `).get(`${currentMonth}%`, `${currentMonth}%`) as {
      month_gross: number;
      month_net: number;
      lifetime_net: number;
    };
    const collectedThisMonth = (this.database.db.prepare(`
      SELECT COUNT(DISTINCT c.child_seat_id) AS count
      FROM receipt r
      JOIN seat_billing_cycle c ON c.id = r.billing_cycle_id
      WHERE r.received_local_date LIKE ? AND r.voided_at IS NULL
    `).get(`${currentMonth}%`) as { count: number }).count;

    let monthlyReceivable = 0;
    for (const seat of children) {
      monthlyReceivable += Math.round(this.convertToCny(seat.charge.minor, seat.charge.currency) / seat.cycleMonths);
    }
    let monthlyCost = 0;
    const spaceMonthlyCosts = new Map<string, number>();
    for (const space of spaces) {
      const converted =
        space.sourceCostCnyMinor ?? this.convertToCny(space.sourceCost.minor, space.sourceCost.currency);
      const row = this.database.db.prepare("SELECT cycle_months FROM team_space WHERE id = ?").get(space.id) as {
        cycle_months: number;
      };
      const value = Math.round(converted / row.cycle_months);
      monthlyCost += value;
      spaceMonthlyCosts.set(space.id, value);
    }
    const coverageRows = this.database.db.prepare(`
      SELECT COALESCE(b.space_id_snapshot, c.space_id) AS space_id,
             COALESCE(SUM(r.net_cny_minor), 0) AS net
      FROM receipt r
      JOIN seat_billing_cycle b ON b.id = r.billing_cycle_id
      JOIN child_seat c ON c.id = b.child_seat_id
      WHERE r.received_local_date LIKE ? AND r.voided_at IS NULL
      GROUP BY COALESCE(b.space_id_snapshot, c.space_id)
    `).all(`${currentMonth}%`) as Array<{ space_id: string; net: number }>;
    const netBySpace = new Map(coverageRows.map((row) => [row.space_id, row.net]));
    const monthlyIncomeRows = this.database.db.prepare(`
      SELECT
        SUBSTR(r.received_local_date, 1, 7) AS month,
        COALESCE(SUM(r.gross_cny_minor), 0) AS gross_cny_minor,
        COALESCE(SUM(r.net_cny_minor), 0) AS net_cny_minor,
        COALESCE(SUM(r.net_usd_minor), 0) AS net_usd_minor,
        COUNT(r.id) AS receipt_count,
        COUNT(DISTINCT b.child_seat_id) AS child_seat_count
      FROM receipt r
      JOIN seat_billing_cycle b ON b.id = r.billing_cycle_id
      WHERE r.voided_at IS NULL
      GROUP BY SUBSTR(r.received_local_date, 1, 7)
      ORDER BY month DESC
    `).all() as Array<{
      month: string;
      gross_cny_minor: number;
      net_cny_minor: number;
      net_usd_minor: number;
      receipt_count: number;
      child_seat_count: number;
    }>;
    const monthlyIncome: DashboardSnapshot["monthlyIncome"] = monthlyIncomeRows.map((row) => ({
      month: row.month,
      grossCnyMinor: row.gross_cny_minor,
      netCnyMinor: row.net_cny_minor,
      netUsdMinor: row.net_usd_minor,
      receiptCount: row.receipt_count,
      childSeatCount: row.child_seat_count,
    }));
    const spacePerformance: DashboardSnapshot["spacePerformance"] = spaces.map((space) => {
      const rentedChildren = space.childSeats.filter((seat) => seat.usageKind === "rental");
      const monthlyRevenueCnyMinor = rentedChildren.reduce((sum, seat) => (
        sum + Math.round(this.convertToCny(seat.charge.minor, seat.charge.currency) / seat.cycleMonths)
      ), 0);
      const monthlyCostCnyMinor = spaceMonthlyCosts.get(space.id) ?? 0;
      const collectedNetCnyMinor = netBySpace.get(space.id) ?? 0;
      return {
        spaceId: space.id,
        displayName: space.displayName,
        serviceKind: space.serviceKind,
        rentedChildSeats: rentedChildren.length,
        monthlyRevenueCnyMinor,
        monthlyCostCnyMinor,
        projectedProfitCnyMinor: monthlyRevenueCnyMinor - monthlyCostCnyMinor,
        collectedNetCnyMinor,
        costCovered: collectedNetCnyMinor >= monthlyCostCnyMinor,
      };
    }).sort((left, right) => {
      if (left.costCovered !== right.costCovered) return left.costCovered ? 1 : -1;
      if (left.projectedProfitCnyMinor !== right.projectedProfitCnyMinor) {
        return left.projectedProfitCnyMinor - right.projectedProfitCnyMinor;
      }
      return left.displayName.localeCompare(right.displayName, "zh-CN");
    });
    let covered = 0;
    for (const space of spaces) {
      if ((netBySpace.get(space.id) ?? 0) >= (spaceMonthlyCosts.get(space.id) ?? 0)) covered += 1;
    }
    const childCount = (status: ChildSeatView["expiryStatus"]): number =>
      children.filter((child) => child.expiryStatus === status).length;
    const motherCount = (status: SpaceListItem["expiryStatus"]): number =>
      spaces.filter((space) => space.expiryStatus === status).length;
    const renewedThisMonth = (this.database.db.prepare(`
      SELECT COUNT(DISTINCT r.space_id) AS count
      FROM renewal_event r
      JOIN team_space s ON s.id = r.space_id
      WHERE r.event_kind = 'renewal' AND r.voided_at IS NULL AND r.paid_local_date LIKE ?
        AND s.archived_at IS NULL AND s.deleted_at IS NULL
    `).get(`${currentMonth}%`) as { count: number }).count;
    return {
      asOf: today,
      monthlyReceivableCnyMinor: monthlyReceivable,
      currentMonthGrossCnyMinor: receiptTotals.month_gross,
      currentMonthNetCnyMinor: receiptTotals.month_net,
      lifetimeNetCnyMinor: receiptTotals.lifetime_net,
      monthlyCostCnyMinor: monthlyCost,
      projectedMonthlyProfitCnyMinor: monthlyReceivable - monthlyCost,
      child: {
        rented: children.length,
        normal: childCount("normal"),
        soon: childCount("soon"),
        today: childCount("today"),
        overdue: childCount("overdue"),
        collectedThisMonth,
      },
      mother: {
        total: spaces.length,
        normal: motherCount("normal"),
        soon: motherCount("soon"),
        today: motherCount("today"),
        overdue: motherCount("overdue"),
        renewedThisMonth,
      },
      costCoverage: { covered, uncovered: spaces.length - covered },
      thresholds: {
        spaceSoonDays: this.soonDays("space.status.soonDays"),
        childSoonDays: this.soonDays("childAccount.status.soonDays"),
      },
      monthlyIncome,
      spacePerformance,
    };
  }
}
