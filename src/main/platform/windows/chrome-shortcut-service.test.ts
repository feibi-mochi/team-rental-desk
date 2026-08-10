import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChromeShortcutService,
  normalizeShortcutName,
  readChromeProfiles,
  type WindowsShortcutOptions,
} from "./chrome-shortcut-service.js";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "team-rental-chrome-shortcuts-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Chrome shortcut service", () => {
  it("lists configured Chrome users without reading passwords or cookies", () => {
    const userData = temporaryDirectory();
    mkdirSync(join(userData, "Default"));
    mkdirSync(join(userData, "Profile 3"));
    writeFileSync(
      join(userData, "Local State"),
      JSON.stringify({
        profile: {
          info_cache: {
            "Profile 3": { name: "1110", user_name: "seat@example.com" },
            Default: { name: "我的 Chrome", user_name: "owner@example.com" },
            "Profile 8": { name: "已经删除", user_name: "stale@example.com" },
            "../outside": { name: "忽略", user_name: "ignore@example.com" },
          },
        },
      }),
      "utf8",
    );

    expect(readChromeProfiles(userData)).toEqual([
      {
        directory: "Default",
        displayName: "我的 Chrome",
        account: "owner@example.com",
      },
      {
        directory: "Profile 3",
        displayName: "1110",
        account: "seat@example.com",
      },
    ]);
  });

  it("creates a shortcut for the selected profile and avoids overwriting", () => {
    const root = temporaryDirectory();
    const shortcutsDirectory = join(root, "shortcuts");
    const chromeExecutable = join(root, "chrome.exe");
    writeFileSync(chromeExecutable, "fake chrome", "utf8");
    mkdirSync(shortcutsDirectory, { recursive: true });
    writeFileSync(join(shortcutsDirectory, "1110.lnk"), "existing", "utf8");
    let written: { path: string; options: WindowsShortcutOptions } | null = null;
    const service = new ChromeShortcutService(
      {
        shortcutsDirectory,
        chromeExecutable,
        previewProfiles: [
          {
            directory: "Profile 3",
            displayName: "1110",
            account: "seat@example.com",
          },
        ],
      },
      (path, options) => {
        written = { path, options };
        writeFileSync(path, "shortcut", "utf8");
        return true;
      },
    );

    const path = service.create({
      label: "1110",
      profileDirectory: "Profile 3",
      url: "https://chatgpt.com/admin/members",
      spaceId: null,
    });

    expect(path).toBe(join(shortcutsDirectory, "1110 (2).lnk"));
    expect(written).not.toBeNull();
    expect(written!.options.target).toBe(chromeExecutable);
    expect(written!.options.args).toContain('--profile-directory="Profile 3"');
    expect(written!.options.args).not.toContain(
      "--ignore-profile-directory-if-not-exists",
    );
    expect(written!.options.args).toContain(
      '"https://chatgpt.com/admin/members"',
    );
  });

  it("rejects a Chrome profile that remains in Local State after its directory is deleted", () => {
    const root = temporaryDirectory();
    const chromeExecutable = join(root, "chrome.exe");
    writeFileSync(chromeExecutable, "fake chrome", "utf8");
    writeFileSync(
      join(root, "Local State"),
      JSON.stringify({
        profile: {
          info_cache: {
            "Profile 9": {
              name: "已删除用户",
              user_name: "deleted@example.com",
            },
          },
        },
      }),
      "utf8",
    );
    let writes = 0;
    const service = new ChromeShortcutService(
      {
        shortcutsDirectory: join(root, "shortcuts"),
        chromeUserDataDirectory: root,
        chromeExecutable,
      },
      () => {
        writes += 1;
        return true;
      },
    );

    expect(service.listProfiles()).toEqual([]);
    expect(() =>
      service.create({
        label: "已删除用户",
        profileDirectory: "Profile 9",
        url: "https://chatgpt.com/",
        spaceId: null,
      }),
    ).toThrow(/已检测到的 Chrome 用户/);
    expect(writes).toBe(0);
  });

  it("rejects unknown profiles and unsafe URL schemes without writing files", () => {
    const root = temporaryDirectory();
    const chromeExecutable = join(root, "chrome.exe");
    writeFileSync(chromeExecutable, "fake chrome", "utf8");
    let writes = 0;
    const service = new ChromeShortcutService(
      {
        shortcutsDirectory: join(root, "shortcuts"),
        chromeExecutable,
        previewProfiles: [
          { directory: "Default", displayName: "默认", account: "" },
        ],
      },
      () => {
        writes += 1;
        return true;
      },
    );

    expect(() =>
      service.create({
        label: "未知用户",
        profileDirectory: "Profile 99",
        url: "https://chatgpt.com/",
        spaceId: null,
      }),
    ).toThrow(/已检测到的 Chrome 用户/);
    expect(() =>
      service.create({
        label: "危险网址",
        profileDirectory: "Default",
        url: "file:///C:/Windows/System32/calc.exe",
        spaceId: null,
      }),
    ).toThrow(/http:\/\//);
    expect(writes).toBe(0);
  });

  it("normalizes names before using them as Windows file names", () => {
    expect(normalizeShortcutName(' 1110: ChatGPT?.lnk ')).toBe("1110 ChatGPT");
  });
});
