import { describe, expect, it } from "vitest";
import { convertCurrencyMinor } from "./money-conversion.js";

describe("currency conversion", () => {
  it("honors different currency minor units", () => {
    expect(
      convertCurrencyMinor(
        10_000,
        { decimalPlaces: 2, unitsPerUsd: "7.2" },
        { decimalPlaces: 2, unitsPerUsd: "1" },
      ),
    ).toBe(1_389);
    expect(
      convertCurrencyMinor(
        1_000,
        { decimalPlaces: 3, unitsPerUsd: "1" },
        { decimalPlaces: 2, unitsPerUsd: "7.2" },
      ),
    ).toBe(720);
  });
});
