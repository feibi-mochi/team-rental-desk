import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { TeamRentalDatabase } from "./database.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("live database migration copy", () => {
  const sourcePath = process.env.TEAM_RENTAL_LIVE_TEST_DB;
  const run = sourcePath ? it : it.skip;

  run("preserves every business row while applying the new schema", () => {
    const root = mkdtempSync(join(tmpdir(), "team-rental-live-migration-"));
    directories.push(root);
    const copyPath = join(root, "team-rental.db");
    copyFileSync(sourcePath!, copyPath);
    const beforeDb = new Database(copyPath, { readonly: true });
    const tables = ["team_space", "mother_account", "child_seat", "seat_billing_cycle", "receipt", "renewal_event", "payment_method", "local_shortcut"];
    const before = new Map(tables.map((table) => [table, (beforeDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count]));
    beforeDb.close();

    const migrated = new TeamRentalDatabase(copyPath);
    const after = new Map(tables.map((table) => [table, (migrated.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count]));
    expect(after).toEqual(before);
    expect(migrated.summary().schemaVersion).toBe(4);
    expect(migrated.db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(migrated.db.pragma("foreign_key_check")).toEqual([]);
    expect((migrated.db.pragma("table_info(receipt)") as Array<{ name: string }>).map((item) => item.name)).toContain("operation_id");
    expect((migrated.db.pragma("table_info(child_seat)") as Array<{ name: string }>).map((item) => item.name)).toContain("archived_by_space");
    expect((migrated.db.pragma("table_info(child_seat)") as Array<{ name: string }>).map((item) => item.name)).toContain("deleted_at");
    expect((migrated.db.pragma("table_info(team_space)") as Array<{ name: string }>).map((item) => item.name)).toContain("deleted_at");
    expect((migrated.db.pragma("table_info(money_unit)") as Array<{ name: string }>).map((item) => item.name)).toContain("deleted_at");
    const billingColumns = (migrated.db.pragma("table_info(seat_billing_cycle)") as Array<{ name: string }>).map((item) => item.name);
    expect(billingColumns).toEqual(expect.arrayContaining([
      "space_id_snapshot",
      "space_name_snapshot",
      "position_number_snapshot",
    ]));
    const activePositionIndex = (
      migrated.db.pragma("index_list(child_seat)") as Array<{ name: string; partial: number }>
    ).find((item) => item.name === "child_seat_active_position");
    expect(activePositionIndex?.partial).toBe(1);
    migrated.close();
  });
});
