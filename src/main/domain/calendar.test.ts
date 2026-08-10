import { describe, expect, it } from "vitest";
import {
  addCalendarMonthsClamped,
  assertLocalDate,
  classifyExpiry,
  differenceInCalendarDays,
} from "./calendar.js";

describe("calendar billing rules", () => {
  it("clamps January 31 to February and restores the anchor day afterwards", () => {
    const february = addCalendarMonthsClamped("2025-01-31", 1, 31);
    expect(february).toBe("2025-02-28");
    expect(addCalendarMonthsClamped(february, 1, 31)).toBe("2025-03-31");
  });

  it("supports February 29 in leap years", () => {
    expect(addCalendarMonthsClamped("2024-01-31", 1, 31)).toBe("2024-02-29");
    expect(addCalendarMonthsClamped("2024-02-29", 12, 29)).toBe("2025-02-28");
  });

  it("keeps a normal payment day across short months", () => {
    expect(addCalendarMonthsClamped("2026-01-30", 1, 30)).toBe("2026-02-28");
    expect(addCalendarMonthsClamped("2026-02-28", 1, 30)).toBe("2026-03-30");
  });

  it("classifies expiry boundaries without time-zone drift", () => {
    expect(classifyExpiry("2026-08-03", "2026-08-04", 5)).toBe("overdue");
    expect(classifyExpiry("2026-08-04", "2026-08-04", 5)).toBe("today");
    expect(classifyExpiry("2026-08-09", "2026-08-04", 5)).toBe("soon");
    expect(classifyExpiry("2026-08-10", "2026-08-04", 5)).toBe("normal");
    expect(differenceInCalendarDays("2026-03-01", "2026-02-28")).toBe(1);
  });

  it("rejects impossible dates", () => {
    expect(() => assertLocalDate("2026-02-29")).toThrow();
    expect(assertLocalDate("2024-02-29")).toBe("2024-02-29");
  });
});
