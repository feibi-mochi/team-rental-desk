// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("Modal", () => {
  it("labels the dialog, traps keyboard focus, and restores the previous focus", () => {
    const before = document.createElement("button");
    before.textContent = "before";
    document.body.append(before);
    before.focus();

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => root.render(<Modal title="测试弹窗" description="弹窗说明" onClose={() => undefined}><button>正文操作</button></Modal>));

    const dialog = container.querySelector<HTMLElement>("[role='dialog']")!;
    const title = container.querySelector("h2")!;
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("弹窗说明");

    buttons.at(-1)!.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(buttons[0]);

    act(() => root.unmount());
    mounted.length = 0;
    expect(document.activeElement).toBe(before);
    container.remove();
    before.remove();
  });

  it("does not close from Escape while an operation is busy", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const onClose = vi.fn();

    act(() => root.render(<Modal title="永久删除" onClose={onClose} closeDisabled><p>处理中</p></Modal>));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-busy")).toBe("true");

    act(() => root.render(<Modal title="永久删除" onClose={onClose}><p>等待确认</p></Modal>));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
