import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(resolve(directory)).flatMap((name) => {
    const path = join(directory, name);
    return statSync(resolve(path)).isDirectory() ? sourceFiles(path) : [path];
  }).filter((path) => path.endsWith(".ts"));
}

describe("public repository bootstrap", () => {
  it("installs cleanly without compiling bundled native prebuilds", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.bootstrap).toBe(
      "npm ci --ignore-scripts && node node_modules/electron/install.js",
    );
    expect(read(".github/workflows/ci.yml")).toContain("npm ci --ignore-scripts");
  });

  it("documents the same safe bootstrap command in both languages", () => {
    expect(read("README.md")).toContain("npm run bootstrap");
    expect(read("docs/i18n/README.zh-CN.md")).toContain("npm run bootstrap");
    expect(read("CONTRIBUTING.md")).toContain("npm run bootstrap");
  });

  it("keeps portable business code free from Electron imports", () => {
    const portableDirectories = [
      "src/main/domain",
      "src/main/database",
      "src/main/backup",
      "src/main/rates",
      "src/main/reminders",
      "src/shared",
    ];
    const offenders = portableDirectories
      .flatMap(sourceFiles)
      .filter((path) => /from ["']electron["']/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it("preserves the Windows one-click user experience while exposing port adapters", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      build?: {
        appId?: string;
        extraResources?: Array<{ from?: string; to?: string }>;
        win?: { target?: string; artifactName?: string };
        nsis?: {
          createDesktopShortcut?: boolean;
          deleteAppDataOnUninstall?: boolean;
          perMachine?: boolean;
        };
      };
    };
    expect(packageJson.build).toMatchObject({
      appId: "com.teamrental.manager.v2",
      win: {
        target: "nsis",
        artifactName: "Team-Rental-Desk-${version}-Setup.${ext}",
      },
      nsis: {
        createDesktopShortcut: true,
        deleteAppDataOnUninstall: false,
        perMachine: false,
      },
    });
    expect(packageJson.build?.extraResources).toEqual(expect.arrayContaining([
      { from: "LICENSE", to: "licenses/Apache-2.0.txt" },
      { from: "NOTICE", to: "licenses/NOTICE.txt" },
      {
        from: "THIRD_PARTY_NOTICES.md",
        to: "licenses/THIRD_PARTY_NOTICES.md",
      },
      { from: "ASSET-LICENSE.md", to: "licenses/ASSET-LICENSE.md" },
    ]));
    expect(read("src/main/platform/contracts.ts")).toContain(
      "export interface DesktopPlatform",
    );
    expect(read("src/main/platform/windows/windows-platform.ts")).toContain(
      "export class WindowsDesktopPlatform",
    );
    expect(read("src/main/platform/macos/macos-platform.ts")).toContain(
      "export class MacOSDesktopPlatform",
    );
    expect(read("src/main/platform/linux/linux-platform.ts")).toContain(
      "export class LinuxDesktopPlatform",
    );
  });

  it("checks the portable core on all three desktop operating systems", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain(
      "os: [windows-latest, macos-latest, ubuntu-latest]",
    );
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run build");
  });
});
