import { describe, expect, it } from "vitest";
import { amountStep, formatMoney, majorToMinor, minorToInput } from "./ui";

describe("money form helpers", () => {
  it("uses whole-number steps for zero-decimal currencies", () => {
    expect(amountStep(0)).toBe("1");
    expect(majorToMinor("125", 0)).toBe(125);
    expect(() => majorToMinor("125.5", 0)).toThrow(/0 位小数/);
  });

  it("keeps editable inputs free of currency symbols", () => {
    expect(minorToInput(2_500, 2)).toBe("25.00");
    expect(minorToInput(125, 0)).toBe("125");
  });

  it("renders historical zero-decimal amounts without dividing them by one hundred", () => {
    expect(formatMoney(10_000, "JPY", 0)).toContain("10,000");
    expect(formatMoney(10_000, "JPY", 0)).not.toContain("100.00");
  });
});
