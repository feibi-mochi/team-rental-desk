import { describe, expect, it, vi } from "vitest";
import { createShutdownLifecycle } from "./shutdown-lifecycle.js";

describe("shutdown lifecycle", () => {
  it("keeps the database open while BrowserWindow close handlers are still running", () => {
    let databaseOpen = true;
    const stopBackground = vi.fn();
    const lifecycle = createShutdownLifecycle(stopBackground, () => { databaseOpen = false; });

    lifecycle.beforeQuit();
    expect(stopBackground).toHaveBeenCalledOnce();
    expect(databaseOpen).toBe(true);

    // Electron closes BrowserWindows between before-quit and will-quit.
    expect(databaseOpen).toBe(true);
    lifecycle.willQuit();
    expect(databaseOpen).toBe(false);
  });

  it("is idempotent when Electron repeats quit events", () => {
    const stopBackground = vi.fn();
    const closeDatabase = vi.fn();
    const lifecycle = createShutdownLifecycle(stopBackground, closeDatabase);
    lifecycle.beforeQuit();
    lifecycle.beforeQuit();
    lifecycle.willQuit();
    lifecycle.willQuit();
    expect(stopBackground).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
  });
});
