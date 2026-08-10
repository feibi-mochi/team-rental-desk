import { mkdtempSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { BackupService } from "../backup/backup-service.js";
import { TeamRentalDatabase } from "../database/database.js";
import { TeamRentalRepository } from "../database/repository.js";
import { LegacyImporter } from "./legacy-importer.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("LegacyImporter real-copy compatibility", () => {
  const oldDatabase = process.env.TEAM_RENTAL_LEGACY_TEST_DB;
  const run = oldDatabase ? it : it.skip;

  run("imports a read-only copy without changing the source", async () => {
    const root = mkdtempSync(join(tmpdir(), "team-rental-import-"));
    temporaryDirectories.push(root);
    const dataDirectory = join(root, "data");
    const target = new TeamRentalDatabase(join(dataDirectory, "new.db"));
    const backup = new BackupService(target, join(root, "backups"), join(root, "app"), dataDirectory);
    const importer = new LegacyImporter(target, backup);

    const result = await importer.import(oldDatabase!);

    expect(result).toMatchObject({ spaces: 7, motherAccounts: 7, childSeats: 12, paymentMethods: 6 });
    expect(target.db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(target.db.pragma("foreign_key_check")).toEqual([]);
    const spaces = new TeamRentalRepository(target).listSpaces("2026-08-04");
    expect(spaces).toHaveLength(7);
    expect(spaces.flatMap((space) => space.childSeats)).toHaveLength(12);
    const shortcuts = new TeamRentalRepository(target).listShortcuts();
    expect(shortcuts).toHaveLength(7);
    expect(shortcuts.every((item) => !/[\\/]/.test(item.label) && isAbsolute(item.targetPath) && item.available)).toBe(true);
    target.close();
  });

  it("stores immutable space and position snapshots for imported receipts", async () => {
    const root = mkdtempSync(join(tmpdir(), "team-rental-import-snapshot-"));
    temporaryDirectories.push(root);
    const sourcePath = join(root, "app.db");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE currency (
        code TEXT PRIMARY KEY, name TEXT, minor_unit INTEGER, is_active INTEGER, symbol TEXT
      );
      CREATE TABLE payment_channel (
        id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER, created_at TEXT
      );
      CREATE TABLE space (
        id INTEGER PRIMARY KEY, name TEXT, opening_date TEXT, current_period_start_date TEXT,
        expiry_date TEXT, period_unit TEXT, period_count INTEGER, amount_minor INTEGER,
        is_active INTEGER, rate_as_of TEXT, payment_channel_id INTEGER, currency_code TEXT,
        amount_usd INTEGER, amount_cny INTEGER, country TEXT, archived_at TEXT,
        shortcut_file_name TEXT
      );
      CREATE TABLE mother_account (
        id INTEGER PRIMARY KEY, space_id INTEGER, email TEXT, seat_type TEXT,
        can_change_seat_type INTEGER
      );
      CREATE TABLE child_account (
        id INTEGER PRIMARY KEY, space_id INTEGER, joined_date TEXT, monthly_payment_day INTEGER,
        billing_period_unit TEXT, billing_period_count INTEGER, next_payment_date TEXT,
        monthly_rate_source TEXT, monthly_amount_minor INTEGER, seat_type TEXT, email TEXT,
        label TEXT, contact TEXT, monthly_currency_code TEXT,
        initial_collection_received_at TEXT, is_active INTEGER, archived_at TEXT,
        created_at TEXT, updated_at TEXT
      );
      CREATE TABLE child_account_payment (
        id INTEGER PRIMARY KEY, child_account_id INTEGER, due_date TEXT,
        expected_amount_minor INTEGER, currency_code TEXT, status TEXT,
        paid_at TEXT, created_at TEXT
      );
      CREATE TABLE child_account_payment_receipt (
        id INTEGER PRIMARY KEY, payment_id INTEGER, received_at TEXT,
        received_amount_minor INTEGER, fee_amount_minor INTEGER, amount_usd INTEGER,
        net_amount_usd INTEGER, net_amount_cny INTEGER, fee_rate_bps INTEGER
      );
    `);
    source.prepare("INSERT INTO currency VALUES ('USD', '美元', 2, 1, '$')").run();
    source.prepare("INSERT INTO currency VALUES ('CNY', '人民币', 2, 1, '¥')").run();
    source.prepare("INSERT INTO payment_channel VALUES (1, '测试渠道', 1, '2026-08-01T00:00:00.000Z')").run();
    source.prepare(`
      INSERT INTO space VALUES (
        1, '旧版空间甲', '2026-07-01', '2026-08-01', '2026-09-01',
        'month', 1, 18000, 1, '2026-08-01T00:00:00.000Z', 1, 'CNY',
        2500, 18000, 'CN', NULL, NULL
      )
    `).run();
    source.prepare(`
      INSERT INTO space VALUES (
        2, '已归档空间乙', '2026-06-01', '2026-07-01', '2026-08-01',
        'month', 1, 20000, 0, '2026-08-05T00:00:00.000Z', 1, 'CNY',
        2800, 20000, 'CN', '2026-08-05T00:00:00.000Z', NULL
      )
    `).run();
    source.prepare("INSERT INTO mother_account VALUES (1, 1, 'owner@example.com', 'chatgpt', 0)").run();
    source.prepare("INSERT INTO mother_account VALUES (2, 2, 'archived-owner@example.com', 'chatgpt', 0)").run();
    source.prepare(`
      INSERT INTO child_account VALUES (
        1, 1, '2026-08-01', 1, 'month', 1, '2026-09-01', 'manual',
        10000, 'chatgpt', 'old-customer@example.com', '', 'wx-old', 'CNY',
        '2026-08-01T01:00:00.000Z', 1, NULL,
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
      )
    `).run();
    source.prepare(`
      INSERT INTO child_account VALUES (
        2, 2, '2026-07-01', 1, 'month', 1, '2026-08-01', 'manual',
        9000, 'chatgpt', 'archived-customer@example.com', '', 'wx-archived', 'CNY',
        '2026-07-01T01:00:00.000Z', 0, '2026-08-05T00:00:00.000Z',
        '2026-07-01T00:00:00.000Z', '2026-08-05T00:00:00.000Z'
      )
    `).run();
    source.prepare(`
      INSERT INTO child_account_payment VALUES (
        1, 1, '2026-08-01', 10000, 'CNY', 'paid',
        '2026-08-01T01:00:00.000Z', '2026-08-01T00:00:00.000Z'
      )
    `).run();
    source.prepare(`
      INSERT INTO child_account_payment_receipt VALUES (
        1, 1, '2026-08-01T01:00:00.000Z', 10000, 0, 1389, 1389, 10000, 0
      )
    `).run();
    source.close();

    const dataDirectory = join(root, "data");
    const target = new TeamRentalDatabase(join(dataDirectory, "new.db"));
    target.db.prepare("UPDATE money_unit SET enabled = 0, deleted_at = ? WHERE code = 'CNY'")
      .run("2026-08-04T00:00:00.000Z");
    const backup = new BackupService(target, join(root, "backups"), join(root, "app"), dataDirectory);
    const importer = new LegacyImporter(target, backup);

    await importer.import(sourcePath);

    expect(target.db.prepare(`
      SELECT space_id_snapshot, space_name_snapshot, position_number_snapshot
      FROM seat_billing_cycle WHERE id = 'legacy:cycle:1'
    `).get()).toEqual({
      space_id_snapshot: "legacy:space:1",
      space_name_snapshot: "旧版空间甲",
      position_number_snapshot: 1,
    });
    const repository = new TeamRentalRepository(target);
    expect(repository.listCurrencies().find((currency) => currency.code === "CNY"))
      .toMatchObject({ enabled: true, decimalPlaces: 2 });
    expect(repository.listTransactions().receipts[0]).toMatchObject({
      spaceId: "legacy:space:1",
      spaceName: "旧版空间甲",
    });
    expect(target.db.prepare(`
      SELECT archived_at, archived_by_space FROM child_seat WHERE id = 'legacy:child:2'
    `).get()).toEqual({
      archived_at: "2026-08-05T00:00:00.000Z",
      archived_by_space: 1,
    });
    expect(repository.listArchivedSpaces("2026-08-09").map((space) => space.id))
      .toContain("legacy:space:2");
    repository.unarchiveSpace("legacy:space:2");
    expect(repository.listSpaces("2026-08-09").find((space) => space.id === "legacy:space:2")?.childSeats)
      .toHaveLength(1);
    expect(target.db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(target.db.pragma("foreign_key_check")).toEqual([]);
    target.close();
  });
});
