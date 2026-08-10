import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { TeamRentalDatabase } from "../database/database.js";
import { BackupService } from "./backup-service.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("BackupService", () => {
  it("publishes only a verified complete backup", async () => {
    const root = mkdtempSync(join(tmpdir(), "team-rental-backup-"));
    temporaryDirectories.push(root);
    const dataDirectory = join(root, "data");
    const database = new TeamRentalDatabase(join(dataDirectory, "app.db"));
    const backupBase = join(root, "backups");
    const service = new BackupService(database, backupBase, join(root, "application"), dataDirectory);
    service.saveSettings({ directory: backupBase, onClose: true, intervalEnabled: true, intervalMinutes: 60, retentionCount: 30 });
    database.setSetting("space.emailReminder.smtpUrl", "smtps://user:secret@example.com:465");

    const result = await service.run("manual");

    expect(result.integrity).toBe("ok");
    expect(existsSync(join(result.directory, "team-rental.db"))).toBe(true);
    expect(readFileSync(join(result.directory, "人工恢复说明.txt"), "utf8")).toContain("人工恢复步骤");
    const copy = new Database(join(result.directory, "team-rental.db"), { readonly: true });
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    expect((copy.prepare("SELECT value FROM app_setting WHERE key = 'space.emailReminder.smtpUrl'").get() as { value: string }).value).toBe("");
    expect(readFileSync(join(result.directory, "settings.json"), "utf8")).not.toContain("secret");
    copy.close();
    database.close();
  });

  it("rejects a backup path inside the live data directory", () => {
    const root = mkdtempSync(join(tmpdir(), "team-rental-backup-"));
    temporaryDirectories.push(root);
    const dataDirectory = join(root, "data");
    const database = new TeamRentalDatabase(join(dataDirectory, "app.db"));
    const service = new BackupService(database, join(root, "backups"), join(root, "application"), dataDirectory);
    expect(() => service.saveSettings({ directory: join(dataDirectory, "copies"), onClose: false, intervalEnabled: false, intervalMinutes: 60, retentionCount: 30 })).toThrow(/数据目录/);
    database.close();
  });

  it("keeps only the configured number of completed backups", async () => {
    const root = mkdtempSync(join(tmpdir(), "team-rental-backup-"));
    temporaryDirectories.push(root);
    const dataDirectory = join(root, "data");
    const database = new TeamRentalDatabase(join(dataDirectory, "app.db"));
    const backupBase = join(root, "backups");
    const service = new BackupService(database, backupBase, join(root, "application"), dataDirectory);
    service.saveSettings({ directory: backupBase, onClose: true, intervalEnabled: true, intervalMinutes: 60, retentionCount: 3 });

    for (let index = 0; index < 5; index += 1) await service.run("manual");

    expect(readdirSync(backupBase, { withFileTypes: true }).filter((item) => item.isDirectory()).length).toBe(3);
    database.close();
  });
});
