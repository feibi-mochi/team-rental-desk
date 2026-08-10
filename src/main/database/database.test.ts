import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { TeamRentalDatabase } from "./database.js";
import { TeamRentalRepository } from "./repository.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("TeamRentalDatabase", () => {
  it("creates a clean versioned database with required currencies", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-db-"));
    temporaryDirectories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));

    expect(database.summary()).toMatchObject({
      schemaVersion: 4,
      spaces: 0,
      motherAccounts: 0,
      childSeats: 0,
      paymentChannels: 0,
    });
    expect(database.db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(database.db.pragma("foreign_key_check")).toEqual([]);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM money_unit").get()).toEqual({ count: 6 });
    database.close();
  });

  it("allows at most one default payment method per space", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-db-"));
    temporaryDirectories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    const now = new Date().toISOString();
    database.db.prepare("INSERT INTO payment_method VALUES (?, ?, '', NULL, ?, ?)").run("p1", "渠道一", now, now);
    database.db.prepare("INSERT INTO payment_method VALUES (?, ?, '', NULL, ?, ?)").run("p2", "渠道二", now, now);
    database.db.prepare(`
      INSERT INTO team_space(
        id, display_name, service_kind, owner_login, country_code, source_currency,
        source_cost_minor, opened_on, current_cycle_started_on, renews_on,
        renewal_anchor_day, cycle_months,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "s1", "测试空间", "chatgpt", "owner@example.com", "CN", "USD", 2500,
      "2026-01-01", "2026-01-01", "2026-02-01", 1, 1, now, now,
    );
    database.db.prepare("INSERT INTO space_payment_method VALUES (?, ?, 1, 0)").run("s1", "p1");

    expect(() =>
      database.db.prepare("INSERT INTO space_payment_method VALUES (?, ?, 1, 1)").run("s1", "p2"),
    ).toThrow();
    database.close();
  });

  it("migrates v3 child slots without overwriting archived customers and backfills billing snapshots", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-db-v3-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "app.db");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE money_unit (
        code TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL,
        decimal_places INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE team_space (
        id TEXT PRIMARY KEY, display_name TEXT NOT NULL, service_kind TEXT NOT NULL,
        owner_login TEXT NOT NULL, country_code TEXT NOT NULL,
        source_currency TEXT NOT NULL REFERENCES money_unit(code),
        source_cost_minor INTEGER NOT NULL, opened_on TEXT NOT NULL,
        current_cycle_started_on TEXT NOT NULL, renews_on TEXT NOT NULL,
        renewal_anchor_day INTEGER NOT NULL, cycle_months INTEGER NOT NULL,
        archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE mother_account (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL UNIQUE REFERENCES team_space(id) ON DELETE CASCADE,
        login TEXT NOT NULL, seat_kind TEXT NOT NULL, can_change_seat_kind INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE child_seat (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES team_space(id) ON DELETE CASCADE,
        position_number INTEGER NOT NULL, seat_kind TEXT NOT NULL, usage_kind TEXT NOT NULL,
        customer_login TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
        joined_on TEXT NOT NULL, charge_currency TEXT NOT NULL REFERENCES money_unit(code),
        charge_minor INTEGER NOT NULL, payment_day INTEGER NOT NULL, next_payment_on TEXT NOT NULL,
        cycle_months INTEGER NOT NULL, pending_first_receipt INTEGER NOT NULL DEFAULT 1,
        customer_revision INTEGER NOT NULL DEFAULT 1, archived_at TEXT,
        archived_by_space INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (space_id, position_number)
      );
      CREATE TABLE seat_billing_cycle (
        id TEXT PRIMARY KEY, child_seat_id TEXT NOT NULL REFERENCES child_seat(id) ON DELETE CASCADE,
        customer_revision INTEGER NOT NULL, customer_login_snapshot TEXT,
        cycle_kind TEXT NOT NULL, starts_on TEXT NOT NULL, due_on TEXT NOT NULL,
        coverage_ends_on TEXT NOT NULL, amount_due_minor INTEGER NOT NULL,
        currency_code TEXT NOT NULL REFERENCES money_unit(code), closed_at TEXT,
        created_at TEXT NOT NULL, UNIQUE (child_seat_id, customer_revision, starts_on)
      );
    `);
    const now = "2026-08-09T00:00:00.000Z";
    legacy.prepare("INSERT INTO money_unit VALUES ('CNY', '人民币', '¥', 2, 1, 0)").run();
    legacy.prepare(`
      INSERT INTO team_space VALUES (
        'space-v3', '旧空间', 'chatgpt', 'owner@example.com', 'CN', 'CNY', 18000,
        '2026-08-01', '2026-08-01', '2026-09-01', 1, 1, NULL, ?, ?
      )
    `).run(now, now);
    legacy.prepare("INSERT INTO mother_account VALUES ('mother-v3', 'space-v3', 'owner@example.com', 'chatgpt', 0, ?, ?)")
      .run(now, now);
    legacy.prepare(`
      INSERT INTO child_seat VALUES (
        'archived-child-v3', 'space-v3', 1, 'chatgpt', 'rental', 'old@example.com', '', '',
        '2026-08-01', 'CNY', 10000, 1, '2026-09-01', 1, 0, 1,
        '2026-08-08T00:00:00.000Z', 0, ?, ?
      )
    `).run(now, now);
    legacy.prepare(`
      INSERT INTO seat_billing_cycle VALUES (
        'cycle-v3', 'archived-child-v3', 1, 'old@example.com', 'initial',
        '2026-08-01', '2026-08-01', '2026-09-01', 10000, 'CNY', ?, ?
      )
    `).run(now, now);
    legacy.close();

    const database = new TeamRentalDatabase(path);
    const repository = new TeamRentalRepository(database);

    expect(database.summary().schemaVersion).toBe(4);
    expect(database.db.prepare(`
      SELECT space_id_snapshot, space_name_snapshot, position_number_snapshot
      FROM seat_billing_cycle WHERE id = 'cycle-v3'
    `).get()).toEqual({
      space_id_snapshot: "space-v3",
      space_name_snapshot: "旧空间",
      position_number_snapshot: 1,
    });
    const replacementId = repository.saveChildSeat({
      spaceId: "space-v3", positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "replacement@example.com", label: "", contact: "", joinedOn: "2026-08-09",
      chargeCurrency: "CNY", chargeMinor: 10000, paymentDay: 9,
      nextPaymentOn: "2026-09-09", cycleMonths: 1,
    });
    expect(replacementId).not.toBe("archived-child-v3");
    expect(database.db.prepare("SELECT customer_login, archived_at FROM child_seat WHERE id = 'archived-child-v3'").get())
      .toEqual({ customer_login: "old@example.com", archived_at: "2026-08-08T00:00:00.000Z" });
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM child_seat").get()).toEqual({ count: 2 });
    expect(database.db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(database.db.pragma("foreign_key_check")).toEqual([]);
    database.close();
  });
});
