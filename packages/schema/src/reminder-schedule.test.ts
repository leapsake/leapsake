import { describe, expect, it } from "vitest";
import {
  type CivilDate,
  compareReminderDue,
  daysUntil,
  dueDateMs,
  dueMsFromIso,
  formatDueIn,
  isoFromDueMs,
  nextOccurrence,
  todayCivil,
} from "./reminder-schedule.js";

/** Local noon on a civil day — a stable `now` for countdown assertions. */
function localNoon(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 12, 0, 0).getTime();
}

/** A CivilDate literal. */
const at = (year: number, month: number, day: number): CivilDate => ({
  year,
  month,
  day,
});

/** The stored due-date epoch for a civil day. */
const due = (year: number, month: number, day: number): number =>
  dueDateMs({ year, month, day });

describe("todayCivil", () => {
  it("reads the local wall-clock date from a given instant", () => {
    expect(todayCivil(localNoon(2026, 7, 12))).toEqual({
      year: 2026,
      month: 7,
      day: 12,
    });
  });
});

describe("daysUntil", () => {
  it("counts whole days forward and backward", () => {
    expect(daysUntil(at(2026, 7, 12), at(2026, 7, 12))).toBe(0);
    expect(daysUntil(at(2026, 7, 12), at(2026, 7, 13))).toBe(1);
    expect(daysUntil(at(2026, 7, 12), at(2026, 7, 22))).toBe(10);
    expect(daysUntil(at(2026, 7, 12), at(2026, 7, 11))).toBe(-1);
  });

  it("spans month and year boundaries", () => {
    expect(daysUntil(at(2026, 12, 31), at(2027, 1, 1))).toBe(1);
    expect(daysUntil(at(2026, 2, 28), at(2026, 3, 1))).toBe(1); // 2026 not leap
  });
});

describe("dueDateMs / civil round-trip", () => {
  it("stores a civil date as UTC midnight and reads it back", () => {
    const ms = dueDateMs({ year: 2026, month: 7, day: 20 });
    expect(new Date(ms).toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(isoFromDueMs(ms)).toBe("2026-07-20");
  });
});

describe("dueMsFromIso", () => {
  it("parses YYYY-MM-DD to UTC midnight", () => {
    expect(dueMsFromIso("2026-07-20")).toBe(
      dueDateMs({ year: 2026, month: 7, day: 20 }),
    );
  });

  it("returns null for blank or malformed input", () => {
    expect(dueMsFromIso("")).toBeNull();
    expect(dueMsFromIso("   ")).toBeNull();
    expect(dueMsFromIso("7/20/2026")).toBeNull();
    expect(dueMsFromIso("2026-13-01")).toBeNull();
    expect(dueMsFromIso("2026-07-40")).toBeNull();
  });
});

describe("formatDueIn", () => {
  const now = localNoon(2026, 7, 12);

  it("names today, tomorrow, and yesterday", () => {
    expect(formatDueIn(due(2026, 7, 12), now)).toBe("today");
    expect(formatDueIn(due(2026, 7, 13), now)).toBe("tomorrow");
    expect(formatDueIn(due(2026, 7, 11), now)).toBe("yesterday");
  });

  it("counts days within a fortnight, then switches to weeks", () => {
    expect(formatDueIn(due(2026, 7, 22), now)).toBe("in 10 days");
    expect(formatDueIn(due(2026, 7, 25), now)).toBe("in 13 days");
    expect(formatDueIn(due(2026, 7, 26), now)).toBe("in 2 weeks");
    expect(formatDueIn(due(2026, 8, 11), now)).toBe("in 4 weeks");
  });

  it("phrases past due dates as N days ago", () => {
    expect(formatDueIn(due(2026, 7, 5), now)).toBe("7 days ago");
  });
});

describe("compareReminderDue", () => {
  it("sorts by dueDate ascending, nulls last, then newest created first", () => {
    const rows = [
      { id: "undated-old", dueDate: null, createdAt: 100 },
      { id: "undated-new", dueDate: null, createdAt: 200 },
      { id: "soon", dueDate: 10, createdAt: 50 },
      { id: "later", dueDate: 20, createdAt: 50 },
    ];
    expect([...rows].sort(compareReminderDue).map((r) => r.id)).toEqual([
      "soon",
      "later",
      "undated-new",
      "undated-old",
    ]);
  });
});

/** Partial milestone date parts, as `nextOccurrence` reads them. */
const parts = (
  year: number | null,
  month: number | null,
  day: number | null,
) => ({ year, month, day });

describe("nextOccurrence", () => {
  const today = at(2026, 7, 12);

  it("recurring: takes this year's date when it hasn't passed", () => {
    // A birthday recorded as month+day (no birth year) later this year.
    expect(nextOccurrence("birthday", parts(null, 7, 22), today)).toEqual(
      at(2026, 7, 22),
    );
  });

  it("recurring: rolls to next year once this year's date has passed", () => {
    expect(nextOccurrence("birthday", parts(null, 3, 9), today)).toEqual(
      at(2027, 3, 9),
    );
  });

  it("recurring: today itself counts as the next occurrence", () => {
    expect(nextOccurrence("birthday", parts(null, 7, 12), today)).toEqual(
      at(2026, 7, 12),
    );
  });

  it("recurring: ignores the anchor year of a full-date birthday (anniversary)", () => {
    // year+month+day birthday — still the next annual anniversary, not the 1992 date.
    expect(nextOccurrence("birthday", parts(1992, 8, 1), today)).toEqual(
      at(2026, 8, 1),
    );
  });

  it("recurring: clamps Feb-29 to Feb-28 in a non-leap target year", () => {
    // 2027 is not a leap year; the Feb-29 birthday lands on Feb-28.
    expect(
      nextOccurrence("birthday", parts(null, 2, 29), at(2026, 6, 1)),
    ).toEqual(at(2027, 2, 28));
    // 2028 IS a leap year — keep the real Feb-29.
    expect(
      nextOccurrence("birthday", parts(null, 2, 29), at(2028, 1, 1)),
    ).toEqual(at(2028, 2, 29));
  });

  it("one-time: returns the event date when today or later, else null", () => {
    // graduation does not recur annually.
    expect(nextOccurrence("graduation", parts(2026, 12, 1), today)).toEqual(
      at(2026, 12, 1),
    );
    expect(nextOccurrence("graduation", parts(2020, 5, 1), today)).toBeNull();
  });

  it("one-time: null without a concrete year to place it", () => {
    expect(nextOccurrence("graduation", parts(null, 5, 1), today)).toBeNull();
  });

  it("returns null when there is no concrete day (no month or no day)", () => {
    expect(
      nextOccurrence("birthday", parts(1992, null, null), today),
    ).toBeNull();
    expect(nextOccurrence("birthday", parts(null, 7, null), today)).toBeNull();
    expect(
      nextOccurrence("birthday", parts(null, null, null), today),
    ).toBeNull();
  });
});
