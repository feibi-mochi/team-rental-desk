import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { TeamRentalDatabase } from "../database/database.js";
import { BackupService } from "./backup-service.js";

describe("live backup verification", () => {
  const sourcePath = process.env.TEAM_RENTAL_LIVE_BACKUP_DB;
  const backupDirectory = process.env.TEAM_RENTAL_LIVE_BACKUP_DIR;
  const run = sourcePath && backupDirectory ? it : it.skip;

  run("creates a verified sanitized backup of the upgraded live database", async () => {
    const database = new TeamRentalDatabase(sourcePath!);
    const service = new BackupService(database, backupDirectory!, "D:/Team 出租管理", dirname(sourcePath!));
    const result = await service.run("manual");
    const copy = new Database(join(result.directory, "team-rental.db"), { readonly: true, fileMustExist: true });
    const smtpValues = copy.prepare("SELECT value FROM app_setting WHERE LOWER(key) LIKE '%.smtpurl'").all() as Array<{ value: string }>;
    expect(result.integrity).toBe("ok");
    expect(result.foreignKeyErrors).toBe(0);
    expect(smtpValues.every((row) => row.value === "")).toBe(true);
    copy.close();
    database.close();
    console.log(`LIVE_BACKUP_DIRECTORY=${result.directory}`);
  });
});
