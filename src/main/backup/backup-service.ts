import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import Database from "better-sqlite3";
import type { BackupResult, BackupSettings } from "../../shared/contracts.js";
import type { TeamRentalDatabase } from "../database/database.js";

export type BackupReason = "manual" | "close" | "interval" | "pre_import";

const RESTORE_GUIDE = `Team 出租管理人工恢复说明

此目录是一份完整的本地数据备份，不会上传，也不会覆盖其他备份。

包含内容：
1. team-rental.db：SQLite 数据库。
2. settings.json：备份当时的本机设置快照；邮箱授权信息已经隐藏。
3. backup-metadata.json：完整性检查结果和创建时间。

人工恢复步骤：
1. 完全关闭 Team 出租管理。
2. 先把当前数据库另行复制保存，切勿直接删除。
3. 在“设置 → 数据备份”中查看当前数据目录。
4. 将本目录内的 team-rental.db 复制到当前数据目录，并改成程序使用的数据库名称。
5. 重新打开程序，检查空间、子位置、支付渠道、收款和设置。
6. 为安全起见，恢复后需要重新填写邮件 SMTP URL。

如果不确定，请不要自行覆盖，保留此目录并寻求协助。
`;

const MANAGED_BACKUP_NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(manual|close|interval|pre_import)(?:_[0-9a-f]{8})?$/i;

function isInside(child: string, parent: string): boolean {
  const result = relative(resolve(parent), resolve(child));
  return result === "" || (!result.startsWith("..") && !isAbsolute(result));
}

function localTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}_${get("hour")}-${get("minute")}-${get("second")}`;
}

export class BackupService {
  constructor(
    private readonly database: TeamRentalDatabase,
    private readonly defaultDirectory: string,
    private readonly applicationDirectory: string,
    private readonly dataDirectory: string,
  ) {}

  getSettings(): BackupSettings {
    const minutes = Number(this.database.getSetting("backup.intervalMinutes") ?? "60");
    return {
      directory: this.database.getSetting("backup.directory") ?? this.defaultDirectory,
      onClose: this.database.getSetting("backup.onClose") === "true",
      intervalEnabled: this.database.getSetting("backup.intervalEnabled") === "true",
      intervalMinutes: Number.isInteger(minutes) && minutes >= 5 && minutes <= 43_200 ? minutes : 60,
      retentionCount: (() => {
        const count = Number(this.database.getSetting("backup.retentionCount") ?? "30");
        return Number.isInteger(count) && count >= 3 && count <= 100 ? count : 30;
      })(),
    };
  }

  saveSettings(settings: BackupSettings): void {
    this.validateDirectory(settings.directory);
    if (!Number.isInteger(settings.intervalMinutes) || settings.intervalMinutes < 5 || settings.intervalMinutes > 43_200) {
      throw new Error("自动备份间隔必须在 5 分钟到 30 天之间");
    }
    if (!Number.isInteger(settings.retentionCount) || settings.retentionCount < 3 || settings.retentionCount > 100) {
      throw new Error("备份保留数量必须在 3 到 100 份之间");
    }
    this.database.db.transaction(() => {
      this.database.setSetting("backup.directory", resolve(settings.directory));
      this.database.setSetting("backup.onClose", String(settings.onClose));
      this.database.setSetting("backup.intervalEnabled", String(settings.intervalEnabled));
      this.database.setSetting("backup.intervalMinutes", String(settings.intervalMinutes));
      this.database.setSetting("backup.retentionCount", String(settings.retentionCount));
    })();
  }

  private pruneCompletedBackups(base: string, keep: number, currentDirectory: string): void {
    const managed = readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && MANAGED_BACKUP_NAME.test(entry.name))
      .map((entry) => {
        const path = resolve(base, entry.name);
        return { name: entry.name, path, modifiedAt: statSync(path).mtimeMs };
      })
      .filter((entry) => dirname(entry.path) === base)
      .sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name));
    const protectedPath = resolve(currentDirectory);
    const older = managed.filter((item) => item.path !== protectedPath);
    for (const item of older.slice(Math.max(0, keep - 1))) {
      if (dirname(item.path) === base && MANAGED_BACKUP_NAME.test(item.name)) {
        rmSync(item.path, { recursive: true, force: true });
        this.database.db.prepare("DELETE FROM backup_run WHERE directory = ?").run(item.path);
      }
    }
  }

  private validateDirectory(directory: string): void {
    if (!directory.trim() || !isAbsolute(directory)) throw new Error("请选择完整的备份路径");
    const resolved = resolve(directory);
    if (isInside(resolved, this.applicationDirectory)) throw new Error("备份目录不能放在程序安装目录里面");
    if (isInside(resolved, this.dataDirectory)) throw new Error("备份目录不能放在正在使用的数据目录里面");
  }

  async run(reason: BackupReason): Promise<BackupResult> {
    const base = resolve(this.getSettings().directory);
    this.validateDirectory(base);
    mkdirSync(base, { recursive: true });
    const label = `${localTimestamp()}_${reason}`;
    let finalDirectory = resolve(base, label);
    if (existsSync(finalDirectory)) finalDirectory = resolve(base, `${label}_${randomUUID().slice(0, 8)}`);
    const temporaryDirectory = resolve(base, `.${label}.${randomUUID()}.partial`);
    if (dirname(temporaryDirectory) !== base || dirname(finalDirectory) !== base) {
      throw new Error("备份路径校验失败");
    }
    mkdirSync(temporaryDirectory, { recursive: false });
    try {
      const databaseFile = resolve(temporaryDirectory, "team-rental.db");
      await this.database.db.backup(databaseFile);
      const sanitized = new Database(databaseFile);
      sanitized.prepare(`
        UPDATE app_setting SET value = '', updated_at = ?
        WHERE LOWER(key) LIKE '%.smtpurl'
      `).run(new Date().toISOString());
      sanitized.close();
      const verification = new Database(databaseFile, { readonly: true, fileMustExist: true });
      const integrity = String(verification.pragma("integrity_check", { simple: true }));
      const foreignKeyRows = verification.pragma("foreign_key_check") as unknown[];
      verification.close();
      if (integrity !== "ok" || foreignKeyRows.length > 0) {
        throw new Error(`备份数据库检查失败：${integrity}，外键错误 ${foreignKeyRows.length} 项`);
      }
      // Opening a WAL-mode database for verification can create empty helper
      // files.  A completed SQLite backup is self-contained, so publishing
      // only the main database avoids confusing these files with restore data.
      rmSync(`${databaseFile}-wal`, { force: true });
      rmSync(`${databaseFile}-shm`, { force: true });
      const settingRows = (this.database.db.prepare("SELECT key, value, updated_at FROM app_setting ORDER BY key").all() as Array<{ key: string; value: string; updated_at: string }>).map((row) => ({
        ...row,
        value: row.key.toLowerCase().endsWith(".smtpurl") ? "[已隐藏，恢复后请重新填写]" : row.value,
      }));
      writeFileSync(
        resolve(temporaryDirectory, "settings.json"),
        JSON.stringify(settingRows, null, 2),
        "utf8",
      );
      const result: BackupResult = {
        directory: finalDirectory,
        integrity,
        foreignKeyErrors: foreignKeyRows.length,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(
        resolve(temporaryDirectory, "backup-metadata.json"),
        JSON.stringify({ ...result, reason, sourceDatabase: this.database.path }, null, 2),
        "utf8",
      );
      writeFileSync(resolve(temporaryDirectory, "人工恢复说明.txt"), RESTORE_GUIDE, "utf8");
      renameSync(temporaryDirectory, finalDirectory);
      this.database.db.prepare(`
        INSERT INTO backup_run(id, reason, directory, integrity_result, foreign_key_errors, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), reason, finalDirectory, integrity, foreignKeyRows.length, result.createdAt);
      this.database.setSetting("backup.lastSuccessAt", result.createdAt);
      this.pruneCompletedBackups(base, this.getSettings().retentionCount, finalDirectory);
      return result;
    } catch (error) {
      if (existsSync(temporaryDirectory) && dirname(temporaryDirectory) === base) {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
      throw error;
    }
  }
}
