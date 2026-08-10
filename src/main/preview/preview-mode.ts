import { isAbsolute, relative, resolve } from "node:path";

export const DEVELOPMENT_PREVIEW_SECTIONS = [
  "first_run",
  "dashboard",
  "spaces",
  "shortcuts",
  "transactions",
] as const;

export type DevelopmentPreviewSection = (typeof DEVELOPMENT_PREVIEW_SECTIONS)[number];

export type DevelopmentPreviewConfig = {
  enabled: boolean;
  userDataDirectory: string;
  section: DevelopmentPreviewSection | null;
};

type DevelopmentPreviewInput = {
  isPackaged: boolean;
  defaultUserDataDirectory: string;
  userDataDirectory?: string;
  section?: string;
};

export type DevelopmentPreviewArguments = {
  userDataDirectory?: string;
  section?: string;
};

const USER_DATA_ARGUMENT = "--team-rental-preview-user-data=";
const SECTION_ARGUMENT = "--team-rental-preview-section=";

export function readDevelopmentPreviewArguments(argv: readonly string[]): DevelopmentPreviewArguments {
  const userDataDirectory = argv.find((argument) => argument.startsWith(USER_DATA_ARGUMENT))
    ?.slice(USER_DATA_ARGUMENT.length);
  const section = argv.find((argument) => argument.startsWith(SECTION_ARGUMENT))
    ?.slice(SECTION_ARGUMENT.length);
  return { userDataDirectory, section };
}

function overlaps(left: string, right: string): boolean {
  const nested = relative(left, right);
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested));
}

export function resolveDevelopmentPreviewConfig(input: DevelopmentPreviewInput): DevelopmentPreviewConfig {
  const defaultDirectory = resolve(input.defaultUserDataDirectory);
  if (input.isPackaged) {
    return { enabled: false, userDataDirectory: defaultDirectory, section: null };
  }

  const requestedDirectory = input.userDataDirectory?.trim() ?? "";
  const requestedSection = input.section?.trim() ?? "";
  if (!requestedDirectory && !requestedSection) {
    return {
      enabled: true,
      userDataDirectory: resolve(`${defaultDirectory}-development`),
      section: null,
    };
  }
  if (!requestedDirectory || !requestedSection) {
    throw new Error("截图预览必须同时设置 TEAM_RENTAL_USER_DATA_DIR 和 TEAM_RENTAL_PREVIEW_SECTION");
  }
  if (!isAbsolute(requestedDirectory)) {
    throw new Error("TEAM_RENTAL_USER_DATA_DIR 必须是独立的绝对路径");
  }
  if (!(DEVELOPMENT_PREVIEW_SECTIONS as readonly string[]).includes(requestedSection)) {
    throw new Error(`不支持的截图页面：${requestedSection}`);
  }

  const previewDirectory = resolve(requestedDirectory);
  if (overlaps(defaultDirectory, previewDirectory) || overlaps(previewDirectory, defaultDirectory)) {
    throw new Error("截图预览目录不能与正式数据目录相同或互相包含");
  }
  return {
    enabled: true,
    userDataDirectory: previewDirectory,
    section: requestedSection as DevelopmentPreviewSection,
  };
}

export function appendPreviewSection(url: string, section: DevelopmentPreviewSection): string {
  const target = new URL(url);
  target.searchParams.set("previewSection", section);
  return target.toString();
}
