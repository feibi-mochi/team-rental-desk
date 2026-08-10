import type {
  ChromeProfileView,
  ChromeShortcutInput,
  PlatformCapabilities,
} from "../../shared/contracts.js";

export type NativeNotificationInput = {
  title: string;
  body: string;
};

export type ChromeShortcutPlatformOptions = {
  shortcutsDirectory: string;
  chromeUserDataDirectory?: string;
  chromeExecutable?: string;
  previewProfiles?: readonly ChromeProfileView[];
  isolatedChromeUserDataDirectory?: string;
};

/**
 * Stable boundary used by the application and IPC layers.
 *
 * Community ports can replace only this provider while keeping the renderer,
 * database, accounting rules, migrations, reminders, and tests unchanged.
 */
export interface ChromeShortcutProvider {
  listProfiles(): ChromeProfileView[];
  create(input: ChromeShortcutInput): string;
  removeCreated(path: string): void;
}

/**
 * Operating-system features that must not leak into portable business code.
 */
export interface DesktopPlatform {
  readonly id: NodeJS.Platform;
  readonly capabilities: PlatformCapabilities;
  readonly chromeShortcuts: ChromeShortcutProvider;
  setStartupCheckEnabled(enabled: boolean): void;
  showNotification(input: NativeNotificationInput): boolean;
}
