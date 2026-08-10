import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}));

import { loadWindowState } from "./window-state.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("window state", () => {
  it("recenters a window saved on a disconnected monitor", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-window-"));
    directories.push(directory);
    const path = join(directory, "window-state.json");
    writeFileSync(path, JSON.stringify({ x: 50_000, y: 100, width: 1200, height: 800, maximized: false }));

    const state = loadWindowState(path);

    expect(state.x).toBeGreaterThanOrEqual(0);
    expect(state.x + state.width).toBeLessThanOrEqual(1920);
    expect(state.y + state.height).toBeLessThanOrEqual(1080);
  });

  it("keeps a visible saved position", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-rental-window-"));
    directories.push(directory);
    const path = join(directory, "window-state.json");
    writeFileSync(path, JSON.stringify({ x: 120, y: 90, width: 1100, height: 760, maximized: false }));
    expect(loadWindowState(path)).toEqual({ x: 120, y: 90, width: 1100, height: 760, maximized: false });
  });
});
