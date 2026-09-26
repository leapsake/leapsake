import { describe, expect, it } from "vitest";
import {
  checkDueDate,
  civilFromParts,
  earliestDueIso,
  isoFromParts,
  monthBlankOrValid,
  partsFromIso,
} from "./date-parts.js";
import { dueDateMs } from "./reminder-schedule.js";

// Local noon on 24 September 2026, so "today" is the same civil day in any zone.
const NOW = new Date(2026, 8, 24, 12).getTime();

const parts = (month: string, day: string, year: string) => ({
  month,
  day,
  year,
});

describe("monthBlankOrValid", () => {
  it("accepts a blank month or 1–12, typed with or without a leading zero", () => {
    for (const month of ["", " ", "1", "03", "12"]) {
      expect(monthBlankOrValid(month)).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const month of ["0", "13", "-1", "1.5", "Mar"]) {
      expect(monthBlankOrValid(month)).toBe(false);
    }
  });
});

describe("civilFromParts", () => {
  it("reads a complete date", () => {
    expect(civilFromParts(parts("8", "01", "2026"))).toEqual({
      year: 2026,
      month: 8,
      day: 1,
    });
  });

  it("refuses a day the month does not have, rather than rolling it over", () => {
    expect(civilFromParts(parts("2", "31", "2026"))).toBeNull();
    expect(civilFromParts(parts("4", "31", "2026"))).toBeNull();
    expect(civilFromParts(parts("2", "29", "2027"))).toBeNull();
    expect(civilFromParts(parts("2", "29", "2028"))).not.toBeNull();
  });

  it("refuses a missing part", () => {
    expect(civilFromParts(parts("8", "", "2026"))).toBeNull();
    expect(civilFromParts(parts("8", "1", ""))).toBeNull();
  });
});

describe("a date input’s value", () => {
  it("round-trips a day that exists", () => {
    expect(isoFromParts(parts("8", "1", "2026"))).toBe("2026-08-01");
    expect(partsFromIso("2026-08-01")).toEqual(parts("8", "1", "2026"));
  });

  it("is empty for a date that does not exist, and blank parts for an empty input", () => {
    expect(isoFromParts(parts("2", "31", "2026"))).toBe("");
    expect(isoFromParts(parts("", "", "2026"))).toBe("");
    expect(partsFromIso("")).toEqual(parts("", "", ""));
  });
});

describe("checkDueDate", () => {
  it("has no due date when neither month nor day is typed, whatever the year", () => {
    expect(checkDueDate(parts("", "", "2026"), null, NOW)).toEqual({
      ok: true,
      dueMs: null,
    });
  });

  it("accepts today and later", () => {
    expect(checkDueDate(parts("9", "24", "2026"), null, NOW)).toEqual({
      ok: true,
      dueMs: dueDateMs({ year: 2026, month: 9, day: 24 }),
    });
    expect(checkDueDate(parts("1", "2", "2027"), null, NOW).ok).toBe(true);
  });

  it("refuses a past day", () => {
    expect(checkDueDate(parts("9", "23", "2026"), null, NOW)).toEqual({
      ok: false,
      problem: "past",
    });
  });

  it("keeps a past due date that was already saved, so the rest can be edited", () => {
    const saved = dueDateMs({ year: 2026, month: 8, day: 1 });
    expect(checkDueDate(parts("8", "1", "2026"), saved, NOW)).toEqual({
      ok: true,
      dueMs: saved,
    });
    expect(checkDueDate(parts("8", "2", "2026"), saved, NOW).ok).toBe(false);
  });

  it("refuses a partial or impossible date", () => {
    for (const typed of [
      parts("9", "", "2026"),
      parts("", "30", "2026"),
      parts("13", "1", "2026"),
      parts("2", "31", "2027"),
    ]) {
      expect(checkDueDate(typed, null, NOW)).toEqual({
        ok: false,
        problem: "invalid",
      });
    }
  });
});

describe("earliestDueIso", () => {
  it("is today, or an earlier day already saved", () => {
    expect(earliestDueIso(null, NOW)).toBe("2026-09-24");
    const saved = dueDateMs({ year: 2026, month: 8, day: 1 });
    expect(earliestDueIso(saved, NOW)).toBe("2026-08-01");
    const later = dueDateMs({ year: 2026, month: 12, day: 1 });
    expect(earliestDueIso(later, NOW)).toBe("2026-09-24");
  });
});
