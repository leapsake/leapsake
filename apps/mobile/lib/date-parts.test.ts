import { describe, expect, it } from "vitest";
import { editDueDate } from "./date-parts";

// Local noon on 24 September 2026, so "today" is the same civil day in any zone.
const NOW = new Date(2026, 8, 24, 12).getTime();

const parts = (month: string, day: string, year: string) => ({
  month,
  day,
  year,
});

const BLANK = { parts: parts("", "", "2026"), yearTouched: false };

describe("a reminder’s due date as it is typed", () => {
  // As the fields do: each edit carries the year currently showing.
  const typeInto = (month: string, day: string) => {
    const withMonth = editDueDate(BLANK, parts(month, "", "2026"), NOW);
    return editDueDate(withMonth, parts(month, day, withMonth.parts.year), NOW)
      .parts.year;
  };

  it("keeps this year for today and anything later in it", () => {
    expect(typeInto("9", "24")).toBe("2026");
    expect(typeInto("12", "1")).toBe("2026");
  });

  it("moves to next year once the month, or the day within this month, has passed", () => {
    expect(typeInto("3", "9")).toBe("2027");
    expect(typeInto("9", "23")).toBe("2027");
  });

  it("follows the month back to this year when it changes again", () => {
    const march = editDueDate(BLANK, parts("3", "", "2026"), NOW);
    expect(march.parts.year).toBe("2027");
    expect(editDueDate(march, parts("11", "", "2027"), NOW).parts.year).toBe(
      "2026",
    );
  });

  it("leaves a year the user typed alone", () => {
    const typed = editDueDate(BLANK, parts("", "", "2030"), NOW);
    expect(editDueDate(typed, parts("3", "9", "2030"), NOW).parts.year).toBe(
      "2030",
    );
  });
});
