import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityDesktopPlatform } from "./community-platform.js";
import { createDesktopPlatform } from "./create-platform.js";
import {
  WindowsDesktopPlatform,
  type WindowsPlatformRuntime,
} from "./windows/windows-platform.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function windowsFixture() {
  const root = mkdtempSync(join(tmpdir(), "team-rental-platform-"));
  directories.push(root);
  const chromeExecutable = join(root, "chrome.exe");
  writeFileSync(chromeExecutable, "test chrome", "utf8");
  const shortcutDirectory = join(root, "shortcuts");
  mkdirSync(shortcutDirectory);

  const loginItems: unknown[] = [];
  const notifications: Array<{ title: string; body: string }> = [];
  const runtime: WindowsPlatformRuntime = {
    isPackaged: true,
    executablePath: "C:\\Program Files\\Team Rental Desk\\Team 出租管理.exe",
    setLoginItemSettings: (settings) => loginItems.push(settings),
    notificationsSupported: () => true,
    createNotification: (input) => {
      notifications.push(input);
      return { once: vi.fn(), show: vi.fn() };
    },
    writeShortcutLink: (path) => {
      writeFileSync(path, "test shortcut", "utf8");
      return true;
    },
  };
  const platform = new WindowsDesktopPlatform(
    {
      shortcutsDirectory: shortcutDirectory,
      chromeExecutable,
      previewProfiles: [
        { directory: "Default", displayName: "默认用户", account: "" },
      ],
    },
    runtime,
  );
  return { platform, loginItems, notifications };
}

describe("desktop platform adapters", () => {
  it("keeps the existing Windows startup and notification behavior behind the adapter", () => {
    const { platform, loginItems, notifications } = windowsFixture();

    platform.setStartupCheckEnabled(true);
    expect(loginItems).toEqual([
      {
        openAtLogin: true,
        name: "Team 出租管理开机提醒",
        path: "C:\\Program Files\\Team Rental Desk\\Team 出租管理.exe",
        args: ["--startup-check"],
      },
    ]);
    expect(
      platform.showNotification({ title: "测试标题", body: "测试正文" }),
    ).toBe(true);
    expect(notifications).toEqual([{ title: "测试标题", body: "测试正文" }]);
    expect(platform.capabilities).toEqual({
      chromeProfileShortcuts: true,
      nativeNotifications: true,
      startupCheck: true,
    });
  });

  it("keeps the Windows Chrome profile shortcut implementation available", () => {
    const { platform } = windowsFixture();
    expect(platform.chromeShortcuts.listProfiles()).toHaveLength(1);
    expect(
      platform.chromeShortcuts.create({
        label: "默认用户",
        profileDirectory: "Default",
        url: "https://chatgpt.com/admin/members",
        spaceId: null,
      }),
    ).toMatch(/默认用户\.lnk$/);
  });

  it("provides a safe community-port template without fake integrations", () => {
    const platform = createDesktopPlatform(
      { shortcutsDirectory: "/tmp/team-rental-shortcuts" },
      "darwin",
    );
    expect(platform.capabilities).toEqual({
      chromeProfileShortcuts: false,
      nativeNotifications: false,
      startupCheck: false,
    });
    expect(platform.chromeShortcuts.listProfiles()).toEqual([]);
    expect(
      platform.showNotification({ title: "测试", body: "测试" }),
    ).toBe(false);
    expect(() =>
      platform.chromeShortcuts.create({
        label: "测试",
        profileDirectory: "Default",
        url: "https://chatgpt.com/",
        spaceId: null,
      }),
    ).toThrow(/社区适配尚未实现/);
    expect(
      createDesktopPlatform(
        { shortcutsDirectory: "/tmp/team-rental-shortcuts" },
        "linux",
      ).id,
    ).toBe("linux");
    expect(new CommunityDesktopPlatform("freebsd").id).toBe("freebsd");
  });
});
