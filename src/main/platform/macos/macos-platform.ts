import { CommunityDesktopPlatform } from "../community-platform.js";

/**
 * Community macOS implementation point.
 *
 * Replace the inherited unavailable capabilities with real macOS login-item,
 * Notification Center, Chrome profile, and profile-pinned launcher behavior.
 * Keep accounting and database code outside this directory unchanged.
 */
export class MacOSDesktopPlatform extends CommunityDesktopPlatform {
  constructor() {
    super("darwin");
  }
}
