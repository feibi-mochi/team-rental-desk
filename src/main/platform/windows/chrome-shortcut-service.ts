import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  ChromeProfileView,
  ChromeShortcutInput,
} from "../../../shared/contracts.js";
import type { ChromeShortcutPlatformOptions } from "../contracts.js";

export type WindowsShortcutOptions = {
  target: string;
  args: string;
  cwd: string;
  icon: string;
  iconIndex: number;
  description: string;
};

export type WindowsShortcutWriter = (
  shortcutPath: string,
  options: WindowsShortcutOptions,
) => boolean;

const DEFAULT_CHATGPT_URL = "https://chatgpt.com/admin/members";

export function defaultChromeUserDataDirectory(): string {
  const localAppData = process.env.LOCALAPPDATA?.trim();
  return localAppData
    ? join(localAppData, "Google", "Chrome", "User Data")
    : join(homedir(), "AppData", "Local", "Google", "Chrome", "User Data");
}

function validProfileDirectory(value: string): boolean {
  return (
    basename(value) === value &&
    value.length > 0 &&
    value.length <= 100 &&
    !/[<>:"/\\|?*\u0000-\u001f]/.test(value)
  );
}

function profileDirectoryExists(userDataDirectory: string, directory: string): boolean {
  try {
    return statSync(join(userDataDirectory, directory)).isDirectory();
  } catch {
    return false;
  }
}

export function readChromeProfiles(
  userDataDirectory = defaultChromeUserDataDirectory(),
): ChromeProfileView[] {
  const localStatePath = join(userDataDirectory, "Local State");
  if (!existsSync(localStatePath)) return [];

  try {
    const localState = JSON.parse(readFileSync(localStatePath, "utf8")) as {
      profile?: {
        info_cache?: Record<
          string,
          { name?: unknown; user_name?: unknown }
        >;
      };
    };
    const infoCache = localState.profile?.info_cache ?? {};
    return Object.entries(infoCache)
      .filter(
        ([directory]) =>
          validProfileDirectory(directory) &&
          profileDirectoryExists(userDataDirectory, directory),
      )
      .map(([directory, profile]) => ({
        directory,
        displayName:
          typeof profile.name === "string" && profile.name.trim()
            ? profile.name.trim()
            : directory,
        account:
          typeof profile.user_name === "string"
            ? profile.user_name.trim()
            : "",
      }))
      .sort((left, right) => {
        if (left.directory === "Default") return -1;
        if (right.directory === "Default") return 1;
        return left.displayName.localeCompare(right.displayName, "zh-Hans-CN", {
          numeric: true,
          sensitivity: "base",
        });
      });
  } catch {
    return [];
  }
}

export function normalizeShortcutName(value: string): string {
  const normalized = value
    .trim()
    .replace(/\.lnk$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 120)
    .trim();
  if (!normalized) throw new Error("请填写快捷方式名称");
  return normalized;
}

function nextAvailableShortcutPath(directory: string, displayName: string): string {
  mkdirSync(directory, { recursive: true });
  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? "" : ` (${index})`;
    const path = resolve(directory, `${displayName}${suffix}.lnk`);
    if (dirname(path).toLowerCase() !== resolve(directory).toLowerCase()) {
      throw new Error("快捷方式路径无效");
    }
    if (!existsSync(path)) return path;
  }
  throw new Error("同名快捷方式过多，请换一个名称");
}

function quoteArgument(value: string): string {
  return `"${value.replace(/([\\]*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function validateUrl(value: string): string {
  if (!value.trim()) throw new Error("请填写打开网址");
  if (value.trim().length > 2_000) throw new Error("打开网址过长");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请填写有效的网址");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("网址必须以 http:// 或 https:// 开头");
  }
  return url.toString();
}

function findChromeExecutable(options: ChromeShortcutPlatformOptions): string {
  const userDataDirectory =
    options.chromeUserDataDirectory ?? defaultChromeUserDataDirectory();
  const candidates = [
    options.chromeExecutable?.trim(),
    process.env.LOCALAPPDATA
      ? join(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : "",
    join(
      process.env.ProgramFiles || "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    resolve(userDataDirectory, "..", "Application", "chrome.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("没有找到 Google Chrome");
  return resolve(executable);
}

export class ChromeShortcutService {
  constructor(
    private readonly options: ChromeShortcutPlatformOptions,
    private readonly writer: WindowsShortcutWriter,
  ) {}

  listProfiles(): ChromeProfileView[] {
    if (this.options.previewProfiles) {
      return this.options.previewProfiles.map((profile) => ({ ...profile }));
    }
    return readChromeProfiles(this.options.chromeUserDataDirectory);
  }

  create(raw: ChromeShortcutInput): string {
    if (
      !raw ||
      typeof raw.label !== "string" ||
      typeof raw.profileDirectory !== "string" ||
      typeof raw.url !== "string" ||
      (raw.spaceId !== null && typeof raw.spaceId !== "string")
    ) {
      throw new Error("快捷方式内容无效");
    }

    const label = normalizeShortcutName(raw.label);
    const profile = this.listProfiles().find(
      (item) => item.directory === raw.profileDirectory,
    );
    if (!profile) throw new Error("请选择已检测到的 Chrome 用户");
    const url = validateUrl(raw.url || DEFAULT_CHATGPT_URL);
    const chromeExecutable = findChromeExecutable(this.options);
    const shortcutPath = nextAvailableShortcutPath(
      this.options.shortcutsDirectory,
      label,
    );
    const argumentsList = [
      this.options.isolatedChromeUserDataDirectory
        ? `--user-data-dir=${quoteArgument(this.options.isolatedChromeUserDataDirectory)}`
        : null,
      `--profile-directory=${quoteArgument(profile.directory)}`,
      quoteArgument(url),
    ].filter((value): value is string => Boolean(value));

    try {
      const created = this.writer(shortcutPath, {
        target: chromeExecutable,
        args: argumentsList.join(" "),
        cwd: dirname(chromeExecutable),
        icon: chromeExecutable,
        iconIndex: 0,
        description: `Team 出租管理：${label}`,
      });
      if (!created || !existsSync(shortcutPath)) {
        throw new Error("快捷方式创建失败");
      }
      return shortcutPath;
    } catch (error) {
      rmSync(shortcutPath, { force: true });
      if (error instanceof Error && error.message === "快捷方式创建失败") {
        throw error;
      }
      throw new Error("快捷方式创建失败，请重试");
    }
  }

  removeCreated(path: string): void {
    const directory = resolve(this.options.shortcutsDirectory);
    const target = resolve(path);
    if (dirname(target).toLowerCase() !== directory.toLowerCase()) return;
    rmSync(target, { force: true });
  }
}
