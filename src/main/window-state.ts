import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { screen } from "electron";
import type { BrowserWindow, Rectangle } from "electron";

type StoredWindowState = Rectangle & { maximized: boolean };

const FALLBACK: StoredWindowState = {
  x: 100,
  y: 80,
  width: 1440,
  height: 920,
  maximized: true,
};

function visibleOnCurrentDisplays(value: Rectangle): boolean {
  try {
    return screen.getAllDisplays().some(({ workArea }) => {
      const width = Math.min(value.x + value.width, workArea.x + workArea.width) - Math.max(value.x, workArea.x);
      const height = Math.min(value.y + value.height, workArea.y + workArea.height) - Math.max(value.y, workArea.y);
      return width >= 120 && height >= 80;
    });
  } catch {
    return true;
  }
}

function fallbackForCurrentDisplay(): StoredWindowState {
  try {
    const { workArea } = screen.getPrimaryDisplay();
    const width = Math.min(FALLBACK.width, workArea.width);
    const height = Math.min(FALLBACK.height, workArea.height);
    return {
      x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
      y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
      width,
      height,
      maximized: FALLBACK.maximized,
    };
  } catch {
    return FALLBACK;
  }
}

export function loadWindowState(path: string): StoredWindowState {
  if (!existsSync(path)) return fallbackForCurrentDisplay();
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredWindowState>;
    if (
      Number.isInteger(value.x) &&
      Number.isInteger(value.y) &&
      Number.isInteger(value.width) &&
      Number.isInteger(value.height) &&
      Number(value.width) >= 900 &&
      Number(value.height) >= 600
    ) {
      const stored = {
        x: Number(value.x),
        y: Number(value.y),
        width: Number(value.width),
        height: Number(value.height),
        maximized: Boolean(value.maximized),
      };
      if (visibleOnCurrentDisplays(stored)) return stored;
    }
  } catch {
    // A damaged state file must not block startup.
  }
  return fallbackForCurrentDisplay();
}

export function saveWindowState(window: BrowserWindow, path: string): void {
  if (window.isMinimized()) return;
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
  writeFileSync(path, JSON.stringify({ ...bounds, maximized: window.isMaximized() }), "utf8");
}
