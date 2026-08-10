import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthStatus, SecuritySettings } from "../../shared/contracts.js";
import type { TeamRentalDatabase } from "../database/database.js";

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 5 * 60_000;
const LOCKOUT_MS = 30_000;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function encodePassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `v1:${salt.toString("hex")}:${derived.toString("hex")}`;
}

function verifyModern(encoded: string, password: string): boolean {
  const [version, saltHex, hashHex] = encoded.split(":");
  if (version !== "v1" || !/^[a-f0-9]{32}$/i.test(saltHex ?? "") || !/^[a-f0-9]{64}$/i.test(hashHex ?? "")) return false;
  const expected = Buffer.from(hashHex!, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex!, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

function validateNewPassword(password: string): void {
  if (!password) throw new Error("新密码不能为空");
}

export class SecurityService {
  private readonly unlocked = new Set<number>();

  constructor(private readonly database: TeamRentalDatabase) {}

  private requiresSetup(): boolean {
    return this.database.getSetting("security.password.needsSetup") === "true";
  }

  private verifyPassword(password: string): boolean {
    const modern = this.database.getSetting("security.password.scrypt") ?? "";
    if (modern) return verifyModern(modern, password);
    const legacyHex = this.database.getSetting("security.password.sha256") ?? "";
    if (!/^[a-f0-9]{64}$/i.test(legacyHex)) return false;
    const expected = Buffer.from(legacyHex, "hex");
    const actual = sha256(password);
    return timingSafeEqual(expected, actual);
  }

  private retryAfterSeconds(now = Date.now()): number {
    const lockedUntil = Number(this.database.getSetting("security.lockout.until") ?? "0");
    return Number.isFinite(lockedUntil) && lockedUntil > now ? Math.ceil((lockedUntil - now) / 1_000) : 0;
  }

  private clearFailures(): void {
    this.database.setSetting("security.lockout.failures", "0");
    this.database.setSetting("security.lockout.windowStartedAt", "0");
    this.database.setSetting("security.lockout.until", "0");
  }

  private registerFailure(now: number): void {
    const started = Number(this.database.getSetting("security.lockout.windowStartedAt") ?? "0");
    let failures = Number(this.database.getSetting("security.lockout.failures") ?? "0");
    if (!Number.isFinite(started) || now - started >= FAILURE_WINDOW_MS) {
      failures = 0;
      this.database.setSetting("security.lockout.windowStartedAt", String(now));
    }
    failures += 1;
    if (failures >= MAX_FAILURES) {
      this.database.setSetting("security.lockout.failures", "0");
      this.database.setSetting("security.lockout.windowStartedAt", "0");
      this.database.setSetting("security.lockout.until", String(now + LOCKOUT_MS));
    } else {
      this.database.setSetting("security.lockout.failures", String(failures));
    }
  }

  private savePassword(password: string): void {
    validateNewPassword(password);
    this.database.db.transaction(() => {
      this.database.setSetting("security.password.scrypt", encodePassword(password));
      this.database.setSetting("security.password.sha256", "");
      this.database.setSetting("security.password.needsSetup", "false");
      this.clearFailures();
    })();
  }

  getSettings(): SecuritySettings {
    const modern = this.database.getSetting("security.password.scrypt") ?? "";
    const legacy = this.database.getSetting("security.password.sha256") ?? "";
    return {
      requirePasswordOnStartup: this.database.getSetting("security.requirePasswordOnStartup") !== "false",
      passwordUsesLegacyHash: !modern && /^[a-f0-9]{64}$/i.test(legacy),
    };
  }

  saveSettings(settings: SecuritySettings): void {
    if (typeof settings?.requirePasswordOnStartup !== "boolean") throw new Error("密码设置无效");
    if (this.requiresSetup() && !settings.requirePasswordOnStartup) throw new Error("请先设置新的登录密码");
    this.database.setSetting("security.requirePasswordOnStartup", String(settings.requirePasswordOnStartup));
  }

  status(webContentsId: number): AuthStatus {
    const requiresPasswordSetup = this.requiresSetup();
    if (!requiresPasswordSetup && !this.getSettings().requirePasswordOnStartup) this.unlocked.add(webContentsId);
    return {
      unlocked: this.unlocked.has(webContentsId),
      retryAfterSeconds: this.retryAfterSeconds(),
      requiresPasswordSetup,
    };
  }

  setupPassword(webContentsId: number, password: string): AuthStatus {
    if (!this.requiresSetup()) throw new Error("登录密码已经设置");
    this.savePassword(password);
    this.unlocked.add(webContentsId);
    return this.status(webContentsId);
  }

  unlock(webContentsId: number, password: string): AuthStatus {
    const now = Date.now();
    if (this.requiresSetup() || this.retryAfterSeconds(now) > 0) return this.status(webContentsId);
    if (this.verifyPassword(password)) {
      this.unlocked.add(webContentsId);
      this.clearFailures();
      return this.status(webContentsId);
    }
    this.registerFailure(now);
    return this.status(webContentsId);
  }

  changePassword(currentPassword: string, newPassword: string): void {
    if (!this.verifyPassword(currentPassword)) throw new Error("当前密码不正确");
    if (currentPassword === newPassword) throw new Error("新密码不能与当前密码相同");
    this.savePassword(newPassword);
  }

  assertUnlocked(webContentsId: number): void {
    if (!this.unlocked.has(webContentsId)) throw new Error("请先输入登录密码");
  }

  clear(webContentsId: number): void {
    this.unlocked.delete(webContentsId);
  }
}
