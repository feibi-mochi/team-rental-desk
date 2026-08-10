import { describe, expect, it } from "vitest";
import { calculatePlatformFee, convertMinor } from "./money.js";

describe("money rules", () => {
  it("supports no fee, 0.6% and 1.6%", () => {
    expect(calculatePlatformFee(10_000, 0)).toEqual({ feeMinor: 0, netMinor: 10_000 });
    expect(calculatePlatformFee(10_000, 60)).toEqual({ feeMinor: 60, netMinor: 9_940 });
    expect(calculatePlatformFee(10_000, 160)).toEqual({ feeMinor: 160, netMinor: 9_840 });
  });

  it("rounds the fee to the smallest currency unit", () => {
    expect(calculatePlatformFee(9_999, 60)).toEqual({ feeMinor: 60, netMinor: 9_939 });
  });

  it("converts between units-per-USD quotes", () => {
    expect(convertMinor(10_000, "7.2", "1")).toBe(1_389);
    expect(convertMinor(10_000, "7.2", "7.2")).toBe(10_000);
  });

  it("rejects unsupported fees", () => {
    expect(() => calculatePlatformFee(10_000, 100)).toThrow();
  });
});
