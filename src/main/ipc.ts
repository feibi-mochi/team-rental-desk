import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import type { BackupSettings, ChildSeatInput, ChromeShortcutInput, CurrencyInput, ReceiptInput, ReminderSettings, RenewalInput, RestoreChildSeatInput, SecuritySettings, SpaceInput } from "../shared/contracts.js";
import type { BackupService } from "./backup/backup-service.js";
import type { TeamRentalDatabase } from "./database/database.js";
import type { TeamRentalRepository } from "./database/repository.js";
import type { LegacyImporter } from "./import/legacy-importer.js";
import type { RateService } from "./rates/rate-service.js";
import type { ReminderService } from "./reminders/reminder-service.js";
import type { SecurityService } from "./security/security-service.js";
import type { ChromeShortcutProvider, DesktopPlatform } from "./platform/contracts.js";

const VALID_PALETTES = new Set([
  "forest", "orange", "red", "brick", "magenta", "pink", "purple", "violet", "green",
  "olive", "blue", "indigo", "lavender", "teal", "slate", "stone", "graphite", "black",
]);

export function registerIpc(services: {
  database: TeamRentalDatabase;
  repository: TeamRentalRepository;
  backup: BackupService;
  importer: LegacyImporter;
  rates: RateService;
  reminders: ReminderService;
  security: SecurityService;
  chromeShortcuts: ChromeShortcutProvider;
  platform: Pick<DesktopPlatform, "id" | "capabilities">;
}): void {
  const { database, repository, backup, importer, rates, reminders, security, chromeShortcuts, platform } = services;
  const secureHandle = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
  ) => ipcMain.handle(channel, (event, ...args) => {
    security.assertUnlocked(event.sender.id);
    return listener(event, ...args);
  });

  ipcMain.handle("auth:status", (event) => {
    const status = security.status(event.sender.id);
    if (status.unlocked) {
      const id = event.sender.id;
      event.sender.once("destroyed", () => security.clear(id));
    }
    return status;
  });
  ipcMain.handle("auth:unlock", (event, password: string) => {
    const status = security.unlock(event.sender.id, typeof password === "string" ? password : "");
    if (status.unlocked) {
      const id = event.sender.id;
      event.sender.once("destroyed", () => security.clear(id));
    }
    return status;
  });
  ipcMain.handle("auth:setup-password", (event, password: string) => {
    const status = security.setupPassword(event.sender.id, typeof password === "string" ? password : "");
    if (status.unlocked) {
      const id = event.sender.id;
      event.sender.once("destroyed", () => security.clear(id));
    }
    return status;
  });
  secureHandle("security:settings:get", () => security.getSettings());
  secureHandle("security:settings:save", (_event, settings: SecuritySettings) => security.saveSettings(settings));
  secureHandle("security:password:change", (_event, currentPassword: string, newPassword: string) => security.changePassword(currentPassword, newPassword));
  secureHandle("app:bootstrap", () => ({
    appVersion: app.getVersion(),
    platform: platform.id,
    platformCapabilities: platform.capabilities,
    database: database.summary(),
    palette: database.getSetting("ui.palette.mode") ?? "teal",
  }));
  secureHandle("dashboard:get", () => repository.dashboard());
  secureHandle("spaces:list", () => repository.listSpaces());
  secureHandle("spaces:list-archived", () => repository.listArchivedSpaces());
  secureHandle("children:list-archived", () => repository.listArchivedChildSeats());
  secureHandle("spaces:save", (_event, input: SpaceInput) => repository.saveSpace(input));
  secureHandle("spaces:archive", (_event, id: string) => repository.archiveSpace(id));
  secureHandle("spaces:unarchive", (_event, id: string) => repository.unarchiveSpace(id));
  secureHandle("spaces:delete-archived", (_event, id: string) => repository.deleteArchivedSpace(id));
  secureHandle("children:save", (_event, input: ChildSeatInput) => repository.saveChildSeat(input));
  secureHandle("children:archive", (_event, id: string) => repository.archiveChildSeat(id));
  secureHandle("children:restore", (_event, input: RestoreChildSeatInput) => repository.restoreChildSeat(input));
  secureHandle("children:delete-archived", (_event, id: string) => repository.deleteArchivedChildSeat(id));
  secureHandle("receipts:record", async (_event, input: ReceiptInput) => {
    await rates.refresh().catch(() => undefined);
    repository.recordReceipt(input);
  });
  secureHandle("spaces:renew", async (_event, input: RenewalInput) => {
    await rates.refresh().catch(() => undefined);
    repository.renewSpace(input);
  });
  secureHandle("transactions:list", () => repository.listTransactions());
  secureHandle("receipts:void", (_event, id: string, reason: string) => repository.voidReceipt(id, reason));
  secureHandle("renewals:void", (_event, id: string, reason: string) => repository.voidRenewal(id, reason));
  secureHandle("payments:list", (_event, includeArchived?: boolean) => repository.listPaymentMethods(includeArchived));
  secureHandle("payments:save", (_event, input: { id?: string; name: string; note: string }) => repository.savePaymentMethod(input));
  secureHandle("payments:archive", (_event, id: string, archived: boolean) => repository.setPaymentMethodArchived(id, archived));
  secureHandle("payments:delete", (_event, id: string) => repository.deletePaymentMethod(id));
  secureHandle("currencies:list", (_event, includeDeleted?: boolean) => repository.listCurrencies(includeDeleted));
  secureHandle("currencies:save", (_event, input: CurrencyInput) => repository.saveCurrency(input));
  secureHandle("currencies:delete", (_event, code: string) => repository.deleteCurrency(code));
  secureHandle("currencies:refresh-rates", () => rates.refresh());
  secureHandle("reminders:settings:get", () => reminders.getSettings());
  secureHandle("reminders:settings:save", (_event, settings: ReminderSettings) => reminders.saveSettings(settings));
  secureHandle("reminders:test", (_event, kind: "space" | "child") => reminders.sendTest(kind));
  secureHandle("reminders:windows:test", () => reminders.sendWindowsTest());
  secureHandle("shortcuts:list", () => repository.listShortcuts());
  secureHandle("shortcuts:chrome-profiles", () => chromeShortcuts.listProfiles());
  secureHandle("shortcuts:create-chrome", (_event, input: ChromeShortcutInput) => {
    const shortcutPath = chromeShortcuts.create(input);
    try {
      return repository.saveShortcut({
        label: input.label,
        targetPath: shortcutPath,
        spaceId: input.spaceId,
      });
    } catch (error) {
      chromeShortcuts.removeCreated(shortcutPath);
      throw error;
    }
  });
  secureHandle("shortcuts:save", (_event, input: { id?: string; label: string; targetPath: string; spaceId: string | null }) => repository.saveShortcut(input));
  secureHandle("shortcuts:delete", (_event, id: string) => repository.deleteShortcut(id));
  secureHandle("shortcuts:choose-target", async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? undefined;
    const options: OpenDialogOptions = {
      properties: ["openFile"],
      filters: [
        { name: "快捷方式或程序", extensions: ["lnk", "exe", "url", "bat", "cmd"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  secureHandle("shortcuts:open", async (_event, id: string) => {
    const shortcut = repository.listShortcuts().find((item) => item.id === id);
    if (!shortcut) throw new Error("快捷方式不存在");
    if (!shortcut.available) throw new Error("原文件已移动或删除，请重新绑定");
    const error = await shell.openPath(shortcut.targetPath);
    if (error) throw new Error(error);
  });
  secureHandle("palette:save", (_event, palette: string) => {
    if (!VALID_PALETTES.has(palette)) throw new Error("不支持这个配色");
    database.setSetting("ui.palette.mode", palette);
  });
  secureHandle("backup:settings:get", () => backup.getSettings());
  secureHandle("backup:settings:save", (_event, settings: BackupSettings) => backup.saveSettings(settings));
  secureHandle("backup:choose-directory", async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? undefined;
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  secureHandle("backup:run", () => backup.run("manual"));
  secureHandle("import:choose-database", async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? undefined;
    const options: OpenDialogOptions = { properties: ["openFile"], filters: [{ name: "旧版 Team 出租数据库", extensions: ["db"] }] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  secureHandle("import:legacy", (_event, path: string) => importer.import(path));
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("window:maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
