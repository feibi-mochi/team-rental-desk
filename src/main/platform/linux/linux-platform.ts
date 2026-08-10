import { CommunityDesktopPlatform } from "../community-platform.js";

/**
 * Community Linux implementation point.
 *
 * Replace the inherited unavailable capabilities with distribution-tested
 * autostart, desktop notification, Chrome/Chromium profile, and `.desktop`
 * launcher behavior. Do not change accounting rules to add OS integration.
 */
export class LinuxDesktopPlatform extends CommunityDesktopPlatform {
  constructor() {
    super("linux");
  }
}
