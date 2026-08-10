import type {
  ChromeShortcutProvider,
  DesktopPlatform,
  NativeNotificationInput,
} from "./contracts.js";

class UnavailableChromeShortcutProvider implements ChromeShortcutProvider {
  constructor(private readonly platform: NodeJS.Platform) {}

  listProfiles() {
    return [];
  }

  create(): never {
    throw new Error(
      `当前 ${this.platform} 社区适配尚未实现 Chrome 用户快捷方式`,
    );
  }

  removeCreated(): void {
    // No file can be created by this unavailable provider.
  }
}

/**
 * Safe, non-pretending template for macOS/Linux/community builds.
 *
 * It deliberately exposes no fake OS integration and never opens a network
 * listener. A porter replaces this adapter one capability at a time.
 */
export class CommunityDesktopPlatform implements DesktopPlatform {
  readonly capabilities = {
    chromeProfileShortcuts: false,
    nativeNotifications: false,
    startupCheck: false,
  } as const;

  readonly chromeShortcuts: ChromeShortcutProvider;

  constructor(readonly id: NodeJS.Platform) {
    this.chromeShortcuts = new UnavailableChromeShortcutProvider(id);
  }

  setStartupCheckEnabled(_enabled: boolean): void {
    // Kept as a safe no-op until the target platform supplies an implementation.
  }

  showNotification(_input: NativeNotificationInput): boolean {
    return false;
  }
}
