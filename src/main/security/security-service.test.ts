import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TeamRentalDatabase } from "../database/database.js";
import { SecurityService } from "./security-service.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SecurityService", () => {
  it("keeps a renderer locked until its password hash matches", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-security-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    database.setSetting(
      "security.password.sha256",
      createHash("sha256").update("test-password").digest("hex"),
    );
    database.setSetting("security.password.needsSetup", "false");
    const security = new SecurityService(database);

    expect(security.status(7).unlocked).toBe(false);
    expect(security.unlock(7, "wrong").unlocked).toBe(false);
    expect(security.unlock(7, "test-password").unlocked).toBe(true);
    expect(() => security.assertUnlocked(7)).not.toThrow();
    security.clear(7);
    expect(() => security.assertUnlocked(7)).toThrow(/登录密码/);
    database.close();
  });

  it("can remember this computer and skip the password on the next startup", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-security-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    const security = new SecurityService(database);

    expect(security.status(19).requiresPasswordSetup).toBe(true);
    expect(security.setupPassword(19, "new-secure-password").unlocked).toBe(true);
    security.clear(19);
    expect(security.getSettings().requirePasswordOnStartup).toBe(true);
    security.saveSettings({ requirePasswordOnStartup: false, passwordUsesLegacyHash: false });
    expect(security.status(19).unlocked).toBe(true);
    expect(() => security.assertUnlocked(19)).not.toThrow();
    database.close();
  });

  it("upgrades to a salted password and supports changing it", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-security-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    const security = new SecurityService(database);

    expect(security.setupPassword(21, "first-secure-password").unlocked).toBe(true);
    expect(database.getSetting("security.password.scrypt")).toMatch(/^v1:/);
    expect(database.getSetting("security.password.sha256")).toBe("");
    security.changePassword("first-secure-password", "second-secure-password");
    security.clear(21);
    expect(security.unlock(21, "first-secure-password").unlocked).toBe(false);
    expect(security.unlock(21, "second-secure-password").unlocked).toBe(true);
    database.close();
  });

  it("accepts short and long non-empty passwords without a character-count limit", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-security-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    const security = new SecurityService(database);
    const longPassword = "长".repeat(256);

    expect(security.setupPassword(25, "1").unlocked).toBe(true);
    security.changePassword("1", longPassword);
    security.clear(25);
    expect(security.unlock(25, longPassword).unlocked).toBe(true);
    expect(() => security.changePassword(longPassword, "")).toThrow(/不能为空/);
    database.close();
  });

  it("keeps lockout state after the service restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-security-"));
    directories.push(directory);
    const database = new TeamRentalDatabase(join(directory, "app.db"));
    const security = new SecurityService(database);
    security.setupPassword(31, "persistent-secure-password");
    security.clear(31);
    for (let attempt = 0; attempt < 5; attempt += 1) security.unlock(31, "wrong-password");

    const restarted = new SecurityService(database);
    expect(restarted.status(32).retryAfterSeconds).toBeGreaterThan(0);
    expect(restarted.unlock(32, "persistent-secure-password").unlocked).toBe(false);
    database.close();
  });
});
