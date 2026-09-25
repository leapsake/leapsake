import { describe, expect, it } from "vitest";
import { dueDateMs } from "@leapsake/schema";
import {
  checkDueDate,
  civilFromParts,
  dueDateDraft,
  editDueDate,
  monthBlankOrValid,
} from "./date-parts";

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

describe("a reminder’s due date as it is typed", () => {
  // As the fields do: each edit carries the year currently showing.
  const typeInto = (month: string, day: string) => {
    const withMonth = editDueDate(
      dueDateDraft(null, NOW),
      parts(month, "", "2026"),
      NOW,
    );
    return editDueDate(withMonth, parts(month, day, withMonth.parts.year), NOW)
      .parts.year;
  };

  it("opens on this year with no month or day", () => {
    expect(dueDateDraft(null, NOW).parts).toEqual(parts("", "", "2026"));
  });

  it("keeps this year for today and anything later in it", () => {
    expect(typeInto("9", "24")).toBe("2026");
    expect(typeInto("12", "1")).toBe("2026");
  });

  it("moves to next year once the month, or the day within this month, has passed", () => {
    expect(typeInto("3", "9")).toBe("2027");
    expect(typeInto("9", "23")).toBe("2027");
  });

  it("follows the month back to this year when it changes again", () => {
    const march = editDueDate(
      dueDateDraft(null, NOW),
      parts("3", "", "2026"),
      NOW,
    );
    expect(march.parts.year).toBe("2027");
    expect(editDueDate(march, parts("11", "", "2027"), NOW).parts.year).toBe(
      "2026",
    );
  });

  it("leaves a year the user typed alone", () => {
    const typed = editDueDate(
      dueDateDraft(null, NOW),
      parts("", "", "2030"),
      NOW,
    );
    expect(editDueDate(typed, parts("3", "9", "2030"), NOW).parts.year).toBe(
      "2030",
    );
  });

  it("opens a saved due date as it was saved", () => {
    const saved = dueDateMs({ year: 2026, month: 8, day: 1 });
    expect(dueDateDraft(saved, NOW).parts).toEqual(parts("8", "1", "2026"));
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
