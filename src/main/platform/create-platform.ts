import type {
  ChromeShortcutPlatformOptions,
  DesktopPlatform,
} from "./contracts.js";
import { CommunityDesktopPlatform } from "./community-platform.js";
import { LinuxDesktopPlatform } from "./linux/linux-platform.js";
import { MacOSDesktopPlatform } from "./macos/macos-platform.js";
import { WindowsDesktopPlatform } from "./windows/windows-platform.js";

export function createDesktopPlatform(
  shortcutOptions: ChromeShortcutPlatformOptions,
  platform: NodeJS.Platform = process.platform,
): DesktopPlatform {
  if (platform === "win32") {
    return new WindowsDesktopPlatform(shortcutOptions);
  }
  if (platform === "darwin") return new MacOSDesktopPlatform();
  if (platform === "linux") return new LinuxDesktopPlatform();
  return new CommunityDesktopPlatform(platform);
}
