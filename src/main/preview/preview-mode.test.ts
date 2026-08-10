import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendPreviewSection,
  readDevelopmentPreviewArguments,
  resolveDevelopmentPreviewConfig,
} from "./preview-mode.js";

const live = resolve("C:\\Users\\demo\\AppData\\Roaming\\team-rental-manager");
const isolated = resolve("D:\\private-preview\\team-rental-public-demo");

describe("development preview isolation", () => {
  it("ignores both preview environment variables in packaged builds", () => {
    expect(resolveDevelopmentPreviewConfig({
      isPackaged: true,
      defaultUserDataDirectory: live,
      userDataDirectory: isolated,
      section: "transactions",
    })).toEqual({ enabled: false, userDataDirectory: live, section: null });
  });

  it("requires an isolated absolute directory and an approved page together", () => {
    expect(() => resolveDevelopmentPreviewConfig({
      isPackaged: false,
      defaultUserDataDirectory: live,
      userDataDirectory: isolated,
    })).toThrow(/同时设置/);
    expect(() => resolveDevelopmentPreviewConfig({
      isPackaged: false,
      defaultUserDataDirectory: live,
      userDataDirectory: "relative-preview",
      section: "dashboard",
    })).toThrow(/绝对路径/);
    expect(() => resolveDevelopmentPreviewConfig({
      isPackaged: false,
      defaultUserDataDirectory: live,
      userDataDirectory: join(live, "preview"),
      section: "dashboard",
    })).toThrow(/正式数据目录/);
    expect(() => resolveDevelopmentPreviewConfig({
      isPackaged: false,
      defaultUserDataDirectory: live,
      userDataDirectory: isolated,
      section: "settings",
    })).toThrow(/不支持/);
  });

  it("keeps ordinary development runs away from the installed app data", () => {
    expect(resolveDevelopmentPreviewConfig({
      isPackaged: false,
      defaultUserDataDirectory: live,
    })).toEqual({
      enabled: true,
      userDataDirectory: resolve(`${live}-development`),
      section: null,
    });
  });

  it("enables only a validated development preview", () => {
    expect(resolveDevelopmentPreviewConfig({
      isPackaged: false,
      defaultUserDataDirectory: live,
      userDataDirectory: isolated,
      section: "spaces",
    })).toEqual({ enabled: true, userDataDirectory: isolated, section: "spaces" });
    expect(resolveDevelopmentPreviewConfig({
      isPackaged: false,
      defaultUserDataDirectory: live,
      userDataDirectory: isolated,
      section: "first_run",
    })).toEqual({ enabled: true, userDataDirectory: isolated, section: "first_run" });
  });

  it("reads a direct-launch review shortcut without a shell script", () => {
    expect(readDevelopmentPreviewArguments([
      "electron.exe",
      "D:\\team-rental-manager",
      `--team-rental-preview-user-data=${isolated}`,
      "--team-rental-preview-section=dashboard",
    ])).toEqual({ userDataDirectory: isolated, section: "dashboard" });
  });

  it("adds the selected page without discarding an existing query", () => {
    expect(appendPreviewSection("http://127.0.0.1:5173/?dev=1", "shortcuts"))
      .toContain("dev=1&previewSection=shortcuts");
  });
});
