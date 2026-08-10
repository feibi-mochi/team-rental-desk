import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { TeamRentalDatabase } from "../database/database.js";
import { TeamRentalRepository } from "../database/repository.js";
import {
  prepareDevelopmentDemoAccess,
  prepareDevelopmentFirstRun,
  seedDevelopmentDemoData,
} from "./demo-data.js";

const directories: string[] = [];
const databases: TeamRentalDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "team-rental-preview-"));
  directories.push(directory);
  const database = new TeamRentalDatabase(join(directory, "demo.db"));
  databases.push(database);
  return { database, repository: new TeamRentalRepository(database) };
}

describe("development demo data", () => {
  it("creates only fictional, internally consistent records and is idempotent", () => {
    const { database, repository } = setup();
    const now = new Date("2026-08-10T02:00:00.000Z");
    expect(seedDevelopmentDemoData(database, repository, now)).toBe(true);
    expect(repository.listSpaces("2026-08-10")).toHaveLength(4);
    expect(repository.listSpaces("2026-08-10").flatMap((space) => space.childSeats)).toHaveLength(8);
    expect(repository.listTransactions().receipts).toHaveLength(14);
    expect(repository.listTransactions().renewals).toHaveLength(3);
    expect(repository.listShortcuts()).toHaveLength(3);
    expect(repository.dashboard("2026-08-10").currentMonthNetCnyMinor).toBeGreaterThan(0);
    expect(database.getSetting("security.requirePasswordOnStartup")).toBe("false");
    expect(database.getSetting("backup.onClose")).toBe("false");
    expect(database.getSetting("reminder.startup.enabled")).toBe("false");
    expect(database.getSetting("ui.palette.mode")).toBe("indigo");

    const identities = database.db.prepare(`
      SELECT owner_login AS value FROM team_space
      UNION ALL SELECT customer_login FROM child_seat
      UNION ALL SELECT contact FROM child_seat WHERE contact <> ''
    `).all() as Array<{ value: string }>;
    expect(identities.length).toBeGreaterThan(0);
    expect(identities.every((item) => item.value.endsWith("@example.com"))).toBe(true);
    expect(repository.listShortcuts().every((item) => !item.targetPath.includes("Users\\"))).toBe(true);

    expect(seedDevelopmentDemoData(database, repository, now)).toBe(false);
    expect(repository.listTransactions().receipts).toHaveLength(14);
  });

  it("keeps business previews unlocked and exposes a real first-run password state separately", () => {
    const { database, repository } = setup();
    seedDevelopmentDemoData(database, repository, new Date("2026-08-10T02:00:00.000Z"));
    database.setSetting("security.requirePasswordOnStartup", "true");
    database.setSetting("security.password.scrypt", "invalid-preview-password");

    prepareDevelopmentDemoAccess(database);
    expect(database.getSetting("security.password.needsSetup")).toBe("false");
    expect(database.getSetting("security.requirePasswordOnStartup")).toBe("false");
    expect(database.getSetting("security.password.scrypt")).toBe("");

    prepareDevelopmentFirstRun(database);
    expect(database.getSetting("security.password.needsSetup")).toBe("true");
    expect(database.getSetting("security.requirePasswordOnStartup")).toBe("true");
    expect(database.getSetting("security.password.scrypt")).toBe("");
    expect(database.getSetting("security.password.sha256")).toBe("");
  });

  it("refuses to seed an existing business database", () => {
    const { database, repository } = setup();
    repository.savePaymentMethod({ name: "已有渠道", note: "" });
    expect(() => seedDevelopmentDemoData(database, repository, new Date("2026-08-10T02:00:00.000Z")))
      .toThrow(/并非空数据库/);
    expect(database.getSetting("preview.demo.seeded")).toBeNull();
  });
});
