import { app, Notification, shell } from "electron";
import type {
  ChromeShortcutPlatformOptions,
  DesktopPlatform,
  NativeNotificationInput,
} from "../contracts.js";
import { ChromeShortcutService } from "./chrome-shortcut-service.js";

type NativeNotificationHandle = {
  once(event: "close", listener: () => void): unknown;
  show(): void;
};

export type WindowsPlatformRuntime = {
  isPackaged: boolean;
  executablePath: string;
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    name: string;
    path: string;
    args: string[];
  }): void;
  notificationsSupported(): boolean;
  createNotification(input: NativeNotificationInput): NativeNotificationHandle;
  writeShortcutLink: ConstructorParameters<typeof ChromeShortcutService>[1];
};

function electronRuntime(): WindowsPlatformRuntime {
  return {
    isPackaged: app.isPackaged,
    executablePath: process.execPath,
    setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
    notificationsSupported: () => Notification.isSupported(),
    createNotification: (input) =>
      new Notification({
        ...input,
        silent: false,
        timeoutType: "default",
      }),
    writeShortcutLink: (path, options) =>
      shell.writeShortcutLink(path, "create", options),
  };
}

export class WindowsDesktopPlatform implements DesktopPlatform {
  readonly id = "win32" as const;
  readonly capabilities = {
    chromeProfileShortcuts: true,
    nativeNotifications: true,
    startupCheck: true,
  } as const;

  readonly chromeShortcuts: ChromeShortcutService;
  private activeNotification: NativeNotificationHandle | null = null;

  constructor(
    shortcutOptions: ChromeShortcutPlatformOptions,
    private readonly runtime: WindowsPlatformRuntime = electronRuntime(),
  ) {
    this.chromeShortcuts = new ChromeShortcutService(
      shortcutOptions,
      runtime.writeShortcutLink,
    );
  }

  setStartupCheckEnabled(enabled: boolean): void {
    if (!this.runtime.isPackaged) return;
    this.runtime.setLoginItemSettings({
      openAtLogin: enabled,
      name: "Team 出租管理开机提醒",
      path: this.runtime.executablePath,
      args: ["--startup-check"],
    });
  }

  showNotification(input: NativeNotificationInput): boolean {
    if (!this.runtime.notificationsSupported()) return false;
    const notification = this.runtime.createNotification(input);
    this.activeNotification = notification;
    notification.once("close", () => {
      if (this.activeNotification === notification) {
        this.activeNotification = null;
      }
    });
    notification.show();
    return true;
  }
}
