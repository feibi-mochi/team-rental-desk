// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PasswordInput } from "./PasswordInput";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("PasswordInput", () => {
  it("starts hidden and lets the user show and hide the entered value", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    act(() => root.render(<PasswordInput value="secret" readOnly />));
    const input = container.querySelector("input")!;
    const button = container.querySelector("button")!;

    expect(input.type).toBe("password");
    expect(button.getAttribute("aria-label")).toBe("显示密码");

    act(() => button.click());
    expect(input.type).toBe("text");
    expect(button.getAttribute("aria-label")).toBe("隐藏密码");

    act(() => button.click());
    expect(input.type).toBe("password");
    act(() => root.unmount());
    mounted.length = 0;
    container.remove();
  });
});
