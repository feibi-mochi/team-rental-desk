import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import Database from "better-sqlite3";
import type { DatabaseSummary } from "../../shared/contracts.js";
import {
  normalizeReminderBody,
  normalizeReminderSubject,
} from "../reminders/defaults.js";

const SCHEMA_VERSION = 4;
const DEFAULT_PASSWORD_SHA256 = "ca8b22d0db83a22db163b560b3e4e51527e533d31d067b614a0c33c4d2df8432";
const VALID_PALETTES = new Set([
  "forest", "orange", "red", "brick", "magenta", "pink", "purple", "violet", "green",
  "olive", "blue", "indigo", "lavender", "teal", "slate", "stone", "graphite", "black",
]);

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS money_unit (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimal_places INTEGER NOT NULL CHECK (decimal_places BETWEEN 0 AND 6),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS exchange_quote (
  code TEXT PRIMARY KEY REFERENCES money_unit(code),
  units_per_usd TEXT NOT NULL,
  provider TEXT NOT NULL,
  quoted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_method (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  note TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_method_active_name
ON payment_method(name)
WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS team_space (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  service_kind TEXT NOT NULL CHECK (service_kind IN ('chatgpt', 'codex')),
  owner_login TEXT NOT NULL,
  country_code TEXT NOT NULL,
  source_currency TEXT NOT NULL REFERENCES money_unit(code),
  source_cost_minor INTEGER NOT NULL CHECK (source_cost_minor >= 0),
  opened_on TEXT NOT NULL,
  current_cycle_started_on TEXT NOT NULL,
  renews_on TEXT NOT NULL,
  renewal_anchor_day INTEGER NOT NULL CHECK (renewal_anchor_day BETWEEN 1 AND 31),
  cycle_months INTEGER NOT NULL CHECK (cycle_months BETWEEN 1 AND 36),
  archived_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS space_payment_method (
  space_id TEXT NOT NULL REFERENCES team_space(id) ON DELETE CASCADE,
  payment_method_id TEXT NOT NULL REFERENCES payment_method(id),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (space_id, payment_method_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_default_payment_method_per_space
ON space_payment_method(space_id)
WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS mother_account (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL UNIQUE REFERENCES team_space(id) ON DELETE CASCADE,
  login TEXT NOT NULL,
  seat_kind TEXT NOT NULL CHECK (seat_kind IN ('chatgpt', 'codex')),
  can_change_seat_kind INTEGER NOT NULL DEFAULT 0 CHECK (can_change_seat_kind IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS child_seat (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES team_space(id) ON DELETE CASCADE,
  position_number INTEGER NOT NULL CHECK (position_number > 0),
  seat_kind TEXT NOT NULL CHECK (seat_kind IN ('chatgpt', 'codex')),
  usage_kind TEXT NOT NULL DEFAULT 'rental' CHECK (usage_kind IN ('rental', 'self_use')),
  customer_login TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  joined_on TEXT NOT NULL,
  charge_currency TEXT NOT NULL REFERENCES money_unit(code),
  charge_minor INTEGER NOT NULL CHECK (charge_minor >= 0),
  payment_day INTEGER NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
  next_payment_on TEXT NOT NULL,
  cycle_months INTEGER NOT NULL CHECK (cycle_months BETWEEN 1 AND 36),
  pending_first_receipt INTEGER NOT NULL DEFAULT 1 CHECK (pending_first_receipt IN (0, 1)),
  customer_revision INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  archived_by_space INTEGER NOT NULL DEFAULT 0 CHECK (archived_by_space IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seat_billing_cycle (
  id TEXT PRIMARY KEY,
  child_seat_id TEXT NOT NULL REFERENCES child_seat(id) ON DELETE CASCADE,
  customer_revision INTEGER NOT NULL,
  customer_login_snapshot TEXT,
  space_id_snapshot TEXT,
  space_name_snapshot TEXT,
  position_number_snapshot INTEGER,
  cycle_kind TEXT NOT NULL CHECK (cycle_kind IN ('initial', 'renewal')),
  starts_on TEXT NOT NULL,
  due_on TEXT NOT NULL,
  coverage_ends_on TEXT NOT NULL,
  amount_due_minor INTEGER NOT NULL CHECK (amount_due_minor >= 0),
  currency_code TEXT NOT NULL REFERENCES money_unit(code),
  closed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (child_seat_id, customer_revision, starts_on)
);

CREATE TABLE IF NOT EXISTS receipt (
  id TEXT PRIMARY KEY,
  operation_id TEXT,
  billing_cycle_id TEXT NOT NULL REFERENCES seat_billing_cycle(id) ON DELETE CASCADE,
  gross_minor INTEGER NOT NULL CHECK (gross_minor > 0),
  fee_basis_points INTEGER NOT NULL CHECK (fee_basis_points IN (0, 60, 160)),
  fee_minor INTEGER NOT NULL CHECK (fee_minor >= 0),
  net_minor INTEGER NOT NULL CHECK (net_minor > 0),
  gross_usd_minor INTEGER NOT NULL CHECK (gross_usd_minor >= 0),
  gross_cny_minor INTEGER NOT NULL CHECK (gross_cny_minor >= 0),
  net_usd_minor INTEGER NOT NULL CHECK (net_usd_minor >= 0),
  net_cny_minor INTEGER NOT NULL CHECK (net_cny_minor >= 0),
  fx_provider TEXT NOT NULL,
  fx_quoted_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  received_local_date TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS renewal_event (
  id TEXT PRIMARY KEY,
  operation_id TEXT,
  space_id TEXT NOT NULL REFERENCES team_space(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL DEFAULT 'renewal' CHECK (event_kind IN ('imported', 'renewal')),
  previous_renews_on TEXT NOT NULL,
  previous_cycle_started_on TEXT,
  next_renews_on TEXT NOT NULL,
  frozen_usd_minor INTEGER NOT NULL CHECK (frozen_usd_minor >= 0),
  frozen_cny_minor INTEGER NOT NULL CHECK (frozen_cny_minor >= 0),
  cny_per_usd TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  paid_local_date TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_shortcut (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  target_path TEXT NOT NULL,
  space_id TEXT REFERENCES team_space(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_delivery (
  id TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('space', 'child_seat')),
  subject_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'windows')),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('startup', 'scheduled', 'test')),
  local_date TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'skipped', 'failed'))
);

CREATE INDEX IF NOT EXISTS reminder_delivery_lookup
ON reminder_delivery(subject_kind, subject_id, channel, local_date);

CREATE TABLE IF NOT EXISTS backup_run (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('manual', 'close', 'interval', 'pre_import')),
  directory TEXT NOT NULL,
  integrity_result TEXT NOT NULL,
  foreign_key_errors INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

const DEFAULT_UNITS = [
  ["USD", "美元", "$", 2, 0],
  ["CNY", "人民币", "¥", 2, 1],
  ["USDT", "泰达币", "₮", 2, 2],
  ["AUD", "澳元", "A$", 2, 3],
  ["GBP", "英镑", "£", 2, 4],
  ["THB", "泰铢", "฿", 2, 5],
] as const;

export class TeamRentalDatabase {
  readonly path: string;
  readonly db: Database.Database;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = OFF");
    try {
      this.migrate();
    } finally {
      this.db.pragma("foreign_keys = ON");
    }
    const foreignKeyErrors = this.db.pragma("foreign_key_check") as unknown[];
    if (foreignKeyErrors.length > 0) throw new Error("数据库升级后的关联校验失败");
  }

  private migrate(): void {
    this.db.transaction(() => {
      this.db.exec(INITIAL_SCHEMA);
      const hasColumn = (table: string, column: string): boolean => (
        this.db.pragma(`table_info(${table})`) as Array<{ name: string }>
      ).some((item) => item.name === column);
      const addColumn = (table: string, column: string, definition: string): void => {
        if (!hasColumn(table, column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      };
      const hadArchiveOrigin = hasColumn("child_seat", "archived_by_space");
      addColumn("money_unit", "deleted_at", "TEXT");
      addColumn("team_space", "deleted_at", "TEXT");
      addColumn("child_seat", "archived_by_space", "INTEGER NOT NULL DEFAULT 0 CHECK (archived_by_space IN (0, 1))");
      addColumn("child_seat", "deleted_at", "TEXT");
      addColumn("seat_billing_cycle", "customer_login_snapshot", "TEXT");
      addColumn("seat_billing_cycle", "space_id_snapshot", "TEXT");
      addColumn("seat_billing_cycle", "space_name_snapshot", "TEXT");
      addColumn("seat_billing_cycle", "position_number_snapshot", "INTEGER");
      addColumn("receipt", "operation_id", "TEXT");
      addColumn("receipt", "voided_at", "TEXT");
      addColumn("receipt", "void_reason", "TEXT NOT NULL DEFAULT ''");
      addColumn("renewal_event", "operation_id", "TEXT");
      addColumn("renewal_event", "previous_cycle_started_on", "TEXT");
      addColumn("renewal_event", "voided_at", "TEXT");
      addColumn("renewal_event", "void_reason", "TEXT NOT NULL DEFAULT ''");
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS receipt_operation_id_unique
        ON receipt(operation_id) WHERE operation_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS renewal_operation_id_unique
        ON renewal_event(operation_id) WHERE operation_id IS NOT NULL;
      `);
      const hasLegacySeatUnique = (this.db.pragma("index_list(child_seat)") as Array<{ origin: string }>)
        .some((index) => index.origin === "u");
      if (hasLegacySeatUnique) {
        this.db.exec(`
          CREATE TABLE child_seat_v4 (
            id TEXT PRIMARY KEY,
            space_id TEXT NOT NULL REFERENCES team_space(id) ON DELETE CASCADE,
            position_number INTEGER NOT NULL CHECK (position_number > 0),
            seat_kind TEXT NOT NULL CHECK (seat_kind IN ('chatgpt', 'codex')),
            usage_kind TEXT NOT NULL DEFAULT 'rental' CHECK (usage_kind IN ('rental', 'self_use')),
            customer_login TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            contact TEXT NOT NULL DEFAULT '',
            joined_on TEXT NOT NULL,
            charge_currency TEXT NOT NULL REFERENCES money_unit(code),
            charge_minor INTEGER NOT NULL CHECK (charge_minor >= 0),
            payment_day INTEGER NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
            next_payment_on TEXT NOT NULL,
            cycle_months INTEGER NOT NULL CHECK (cycle_months BETWEEN 1 AND 36),
            pending_first_receipt INTEGER NOT NULL DEFAULT 1 CHECK (pending_first_receipt IN (0, 1)),
            customer_revision INTEGER NOT NULL DEFAULT 1,
            archived_at TEXT,
            archived_by_space INTEGER NOT NULL DEFAULT 0 CHECK (archived_by_space IN (0, 1)),
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          INSERT INTO child_seat_v4(
            id, space_id, position_number, seat_kind, usage_kind, customer_login, label,
            contact, joined_on, charge_currency, charge_minor, payment_day, next_payment_on,
            cycle_months, pending_first_receipt, customer_revision, archived_at,
            archived_by_space, deleted_at, created_at, updated_at
          )
          SELECT
            id, space_id, position_number, seat_kind, usage_kind, customer_login, label,
            contact, joined_on, charge_currency, charge_minor, payment_day, next_payment_on,
            cycle_months, pending_first_receipt, customer_revision, archived_at,
            archived_by_space, deleted_at, created_at, updated_at
          FROM child_seat;
          DROP TABLE child_seat;
          ALTER TABLE child_seat_v4 RENAME TO child_seat;
        `);
      }
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS child_seat_active_position
        ON child_seat(space_id, position_number)
        WHERE archived_at IS NULL AND deleted_at IS NULL;
      `);
      if (!hadArchiveOrigin) {
        this.db.prepare(`
          UPDATE child_seat
          SET archived_by_space = 1
          WHERE archived_at IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_space s
              WHERE s.id = child_seat.space_id
                AND s.archived_at IS NOT NULL
                AND s.archived_at = child_seat.archived_at
            )
        `).run();
      }
      this.db.prepare(`
        UPDATE seat_billing_cycle
        SET customer_login_snapshot = (
          SELECT customer_login FROM child_seat c WHERE c.id = seat_billing_cycle.child_seat_id
        )
        WHERE customer_login_snapshot IS NULL
      `).run();
      this.db.prepare(`
        UPDATE seat_billing_cycle
        SET
          space_id_snapshot = COALESCE(space_id_snapshot, (
            SELECT c.space_id FROM child_seat c WHERE c.id = seat_billing_cycle.child_seat_id
          )),
          space_name_snapshot = COALESCE(space_name_snapshot, (
            SELECT s.display_name
            FROM child_seat c JOIN team_space s ON s.id = c.space_id
            WHERE c.id = seat_billing_cycle.child_seat_id
          )),
          position_number_snapshot = COALESCE(position_number_snapshot, (
            SELECT c.position_number FROM child_seat c WHERE c.id = seat_billing_cycle.child_seat_id
          ))
        WHERE space_id_snapshot IS NULL OR space_name_snapshot IS NULL OR position_number_snapshot IS NULL
      `).run();
      const now = new Date().toISOString();
      const seed = this.db.prepare(`
        INSERT INTO money_unit(code, name, symbol, decimal_places, sort_order)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(code) DO NOTHING
      `);
      for (const unit of DEFAULT_UNITS) seed.run(...unit);
      this.db.prepare(`
        INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
        VALUES ('USD', '1', 'fixed', ?)
        ON CONFLICT(code) DO NOTHING
      `).run(now);
      this.db
        .prepare(`INSERT INTO app_meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run(String(SCHEMA_VERSION));
      this.db
        .prepare(`INSERT INTO app_meta(key, value) VALUES ('created_or_opened_at', ?) ON CONFLICT(key) DO NOTHING`)
        .run(now);

      if (this.getSetting("security.password.needsSetup") === null) {
        const legacyHash = this.getSetting("security.password.sha256");
        const hasModernHash = Boolean(this.getSetting("security.password.scrypt"));
        this.setSetting(
          "security.password.needsSetup",
          String(!hasModernHash && (!legacyHash || legacyHash === DEFAULT_PASSWORD_SHA256)),
        );
      }
      if (this.getSetting("security.requirePasswordOnStartup") === null) {
        this.setSetting("security.requirePasswordOnStartup", "true");
      }
      if (this.getSetting("backup.onClose") === null) this.setSetting("backup.onClose", "true");
      if (this.getSetting("backup.intervalEnabled") === null) this.setSetting("backup.intervalEnabled", "true");
      if (this.getSetting("backup.intervalMinutes") === null) this.setSetting("backup.intervalMinutes", "60");
      if (this.getSetting("backup.retentionCount") === null) this.setSetting("backup.retentionCount", "30");

      const palette = this.getSetting("ui.palette.mode");
      if (palette !== null && !VALID_PALETTES.has(palette)) this.setSetting("ui.palette.mode", "teal");

      for (const kind of ["space", "child"] as const) {
        const prefix = kind === "space" ? "space" : "childAccount";
        const subjectKey = `${prefix}.emailReminder.templateSubject`;
        const bodyKey = `${prefix}.emailReminder.templateBody`;
        const currentSubject = this.getSetting(subjectKey);
        const currentBody = this.getSetting(bodyKey);
        if (currentSubject !== null) this.setSetting(subjectKey, normalizeReminderSubject(currentSubject, kind));
        if (currentBody !== null) this.setSetting(bodyKey, normalizeReminderBody(currentBody, kind));
      }

      const relativeShortcuts = this.db.prepare(`
        SELECT l.id, l.target_path, s.display_name
        FROM local_shortcut l
        LEFT JOIN team_space s ON s.id = l.space_id
      `).all() as Array<{ id: string; target_path: string; display_name: string | null }>;
      const updateShortcut = this.db.prepare("UPDATE local_shortcut SET target_path = ?, updated_at = ? WHERE id = ?");
      for (const shortcut of relativeShortcuts) {
        if (isAbsolute(shortcut.target_path)) continue;
        const candidates = [
          join(homedir(), "Desktop", "ChatGPT", shortcut.target_path),
          shortcut.display_name ? join(homedir(), "Desktop", "ChatGPT", `${shortcut.display_name}.lnk`) : "",
          join(homedir(), "Desktop", shortcut.target_path),
        ].filter(Boolean);
        const resolved = candidates.find((candidate) => existsSync(candidate));
        if (resolved) updateShortcut.run(resolved, now, shortcut.id);
      }
    })();
  }

  summary(): DatabaseSummary {
    const count = (table: string, where = ""): number => {
      const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as
        | { count: number }
        | undefined;
      return Number(row?.count ?? 0);
    };
    const versionRow = this.db
      .prepare(`SELECT value FROM app_meta WHERE key = 'schema_version'`)
      .get() as { value: string } | undefined;
    return {
      path: this.path,
      schemaVersion: Number(versionRow?.value ?? 0),
      spaces: count("team_space", "WHERE deleted_at IS NULL"),
      motherAccounts: count("mother_account", "WHERE space_id IN (SELECT id FROM team_space WHERE deleted_at IS NULL)"),
      childSeats: count("child_seat", "WHERE deleted_at IS NULL"),
      paymentChannels: count("payment_method"),
    };
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM app_setting WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_setting(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}
