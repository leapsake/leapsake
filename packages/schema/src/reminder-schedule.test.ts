import { describe, expect, it } from "vitest";
import {
  type CivilDate,
  compareReminderDue,
  daysUntil,
  dueDateMs,
  dueMsFromIso,
  formatDueIn,
  isoFromDueMs,
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
