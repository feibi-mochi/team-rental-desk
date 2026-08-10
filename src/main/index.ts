import { dirname, join } from "node:path";
import { appendFileSync } from "node:fs";
import { app, BrowserWindow, dialog } from "electron";
import { BackupService } from "./backup/backup-service.js";
import { TeamRentalDatabase } from "./database/database.js";
import { TeamRentalRepository } from "./database/repository.js";
import { LegacyImporter } from "./import/legacy-importer.js";
import { RateService } from "./rates/rate-service.js";
import { ReminderService } from "./reminders/reminder-service.js";
import { SecurityService } from "./security/security-service.js";
import { createDesktopPlatform } from "./platform/create-platform.js";
import { registerIpc } from "./ipc.js";
import {
  prepareDevelopmentDemoAccess,
  prepareDevelopmentFirstRun,
  seedDevelopmentDemoData,
} from "./preview/demo-data.js";
import {
  appendPreviewSection,
  readDevelopmentPreviewArguments,
  resolveDevelopmentPreviewConfig,
} from "./preview/preview-mode.js";
import { createShutdownLifecycle } from "./shutdown-lifecycle.js";
import { loadWindowState, saveWindowState } from "./window-state.js";

const APP_USER_MODEL_ID = "com.teamrental.manager.v2";

const defaultUserDataDirectory = join(app.getPath("appData"), "team-rental-manager");
const previewArguments = readDevelopmentPreviewArguments(process.argv);
const preview = resolveDevelopmentPreviewConfig({
  isPackaged: app.isPackaged,
  defaultUserDataDirectory,
  userDataDirectory: process.env.TEAM_RENTAL_USER_DATA_DIR || previewArguments.userDataDirectory,
  section: process.env.TEAM_RENTAL_PREVIEW_SECTION || previewArguments.section,
});
app.setPath("userData", preview.userDataDirectory);
if (process.platform === "win32") {
  app.setAppUserModelId(preview.enabled ? `${APP_USER_MODEL_ID}.preview` : APP_USER_MODEL_ID);
}

let mainWindow: BrowserWindow | null = null;
let database: TeamRentalDatabase | null = null;
let backupService: BackupService | null = null;
let closingAfterBackup = false;
let closeRequested = false;
let backupInProgress = false;
let intervalHandle: NodeJS.Timeout | null = null;
let rateIntervalHandle: NodeJS.Timeout | null = null;
let reminderIntervalHandle: NodeJS.Timeout | null = null;

function createMainWindow(): BrowserWindow {
  const stateFile = join(app.getPath("userData"), "window-state.json");
  const state = loadWindowState(stateFile);
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(app.getAppPath(), "resources", "icon.png");
  const window = new BrowserWindow({
    ...state,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f8faf9",
    title: "Team 出租管理",
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let developmentLoadRetries = 0;
  const developmentRendererUrl = process.env.ELECTRON_RENDERER_URL
    ? preview.section
      ? appendPreviewSection(process.env.ELECTRON_RENDERER_URL, preview.section)
      : process.env.ELECTRON_RENDERER_URL
    : null;

  if (!app.isPackaged) {
    const debugLog = join(app.getPath("userData"), "renderer-debug.log");
    const log = (message: string) => appendFileSync(debugLog, `${new Date().toISOString()} ${message}\n`, "utf8");
    window.webContents.on("console-message", (_event, level, message) => log(`console ${level}: ${message}`));
    window.webContents.on("preload-error", (_event, preloadPath, error) => log(`preload ${preloadPath}: ${error.stack ?? error.message}`));
    window.webContents.on("did-fail-load", (_event, code, description, url) => {
      log(`load ${code} ${description} ${url}`);
      if (code === -102 && developmentRendererUrl && developmentLoadRetries < 5) {
        developmentLoadRetries += 1;
        setTimeout(() => void window.loadURL(developmentRendererUrl), 500);
      }
    });
    window.webContents.on("render-process-gone", (_event, details) => log(`renderer gone: ${JSON.stringify(details)}`));
    window.webContents.on("did-finish-load", () => {
      void window.webContents.executeJavaScript(`JSON.stringify({ api: typeof window.teamRental, body: document.body.innerText.slice(0, 500) })`)
        .then((value) => log(`loaded ${value}`))
        .catch((error: unknown) => log(`inspect failed: ${String(error)}`));
    });
  }

  if (state.maximized) window.maximize();
  window.once("ready-to-show", () => window.show());
  window.on("close", () => saveWindowState(window, stateFile));
  window.on("close", (event) => {
    if (closingAfterBackup || !backupService?.getSettings().onClose) return;
    event.preventDefault();
    if (closeRequested) return;
    closeRequested = true;
    window.hide();
    const finishClose = () => {
      if (backupInProgress) {
        setTimeout(finishClose, 300);
        return;
      }
      if (closingAfterBackup) return;
      backupInProgress = true;
      void backupService!.run("close")
        .then(() => {
          backupInProgress = false;
          closingAfterBackup = true;
          window.destroy();
          app.quit();
        })
        .catch(async (error: unknown) => {
          backupInProgress = false;
          const result = await dialog.showMessageBox(window, {
            type: "error",
            title: "关闭备份失败",
            message: "关闭前的数据备份没有完成",
            detail: error instanceof Error ? error.message : String(error),
            buttons: ["重试备份", "仍然退出", "取消关闭"],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
          });
          if (result.response === 0) {
            finishClose();
          } else if (result.response === 1) {
            closingAfterBackup = true;
            window.destroy();
            app.quit();
          } else {
            closeRequested = false;
            window.show();
            window.focus();
          }
        });
    };
    finishClose();
  });

  if (!app.isPackaged && developmentRendererUrl) {
    void window.loadURL(developmentRendererUrl);
  } else {
    const options = preview.section ? { query: { previewSection: preview.section } } : undefined;
    void window.loadFile(join(__dirname, "../renderer/index.html"), options);
  }
  return window;
}

const isStartupCheck = process.argv.includes("--startup-check");
const acquiredLock = isStartupCheck || app.requestSingleInstanceLock();
if (!acquiredLock) {
  app.quit();
} else {
  if (!isStartupCheck) {
    app.on("second-instance", () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
  }

  app.whenReady().then(() => {
    const desktopPlatform = createDesktopPlatform({
      shortcutsDirectory: preview.enabled
        ? join(app.getPath("userData"), "Preview Shortcuts")
        : join(app.getPath("desktop"), "ChatGPT"),
      previewProfiles: preview.enabled
        ? [
            {
              directory: "Default",
              displayName: "Harbor 测试组",
              account: "harbor@example.com",
            },
            {
              directory: "Profile 1",
              displayName: "Cedar 研发组",
              account: "cedar@example.com",
            },
            {
              directory: "Profile 2",
              displayName: "Atlas 运营组",
              account: "atlas@example.com",
            },
          ]
        : undefined,
      isolatedChromeUserDataDirectory: preview.enabled
        ? join(app.getPath("userData"), "Preview Chrome")
        : undefined,
    });
    if (process.argv.includes("--notification-test")) {
      desktopPlatform.showNotification({
        title: "Team 出租管理通知测试",
        body: "以后开机提醒会显示在右下角，不会弹到屏幕中央。",
      });
      setTimeout(() => app.quit(), 8_000);
      return;
    }
    const dataDirectory = join(app.getPath("userData"), "data");
    database = new TeamRentalDatabase(join(dataDirectory, "team-rental.db"));
    const repository = new TeamRentalRepository(database);
    if (preview.enabled && preview.section === "first_run") {
      prepareDevelopmentFirstRun(database);
    } else if (preview.enabled) {
      seedDevelopmentDemoData(database, repository);
      prepareDevelopmentDemoAccess(database);
    }
    const applicationRoot = app.isPackaged ? dirname(dirname(app.getAppPath())) : app.getAppPath();
    const backupDirectory = preview.enabled
      ? join(app.getPath("userData"), "Backups")
      : join(app.getPath("documents"), "Team 出租管理 Backups");
    backupService = new BackupService(
      database,
      backupDirectory,
      applicationRoot,
      dataDirectory,
    );
    const importer = new LegacyImporter(database, backupService);
    const rates = new RateService(database);
    const reminders = new ReminderService(database, repository, desktopPlatform);
    if (isStartupCheck) {
      void reminders.run("startup").catch(() => undefined).finally(() => {
        setTimeout(() => app.quit(), 1_500);
      });
      return;
    }
    const security = new SecurityService(database);
    registerIpc({
      database,
      repository,
      backup: backupService,
      importer,
      rates,
      reminders,
      security,
      chromeShortcuts: desktopPlatform.chromeShortcuts,
      platform: desktopPlatform,
    });
    mainWindow = createMainWindow();
    if (!preview.enabled) {
      void rates.refresh().catch(() => undefined);
      intervalHandle = setInterval(() => {
        if (!backupService || backupInProgress) return;
        const settings = backupService.getSettings();
        if (!settings.intervalEnabled) return;
        const last = Date.parse(database?.getSetting("backup.lastSuccessAt") ?? "");
        if (Number.isFinite(last) && Date.now() - last < settings.intervalMinutes * 60_000) return;
        backupInProgress = true;
        void backupService.run("interval").catch(() => undefined).finally(() => {
          backupInProgress = false;
        });
      }, 60_000);
      rateIntervalHandle = setInterval(() => {
        void rates.refresh().catch(() => undefined);
      }, 30 * 60_000);
      reminderIntervalHandle = setInterval(() => {
        void reminders.runScheduledIfDue().catch(() => undefined);
      }, 30_000);
    }
  });

  app.on("window-all-closed", () => app.quit());
  const shutdown = createShutdownLifecycle(() => {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
    if (rateIntervalHandle) clearInterval(rateIntervalHandle);
    rateIntervalHandle = null;
    if (reminderIntervalHandle) clearInterval(reminderIntervalHandle);
    reminderIntervalHandle = null;
  }, () => {
    database?.close();
    database = null;
  });
  app.on("before-quit", shutdown.beforeQuit);
  app.on("will-quit", shutdown.willQuit);
}
