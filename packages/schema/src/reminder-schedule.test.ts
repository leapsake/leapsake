import { describe, expect, it } from "vitest";
import {
  type CivilDate,
  compareReminderDue,
  daysUntil,
  dueDateMs,
  dueMsFromIso,
  formatBackIn,
  formatComingIn,
  formatDueCountdown,
  formatDueIn,
  isoFromDueMs,
  nextOccurrence,
  recentOccurrence,
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

// The three countdowns Home's sections show, each counting whole civil days so
// the words flip at local midnight like everything else on the list.
describe("formatDueCountdown", () => {
  const now = localNoon(2026, 7, 12);

  it("says when a row on Today is due", () => {
    expect(formatDueCountdown(due(2026, 7, 12), now)).toBe("Due today");
    expect(formatDueCountdown(due(2026, 7, 13), now)).toBe("Due tomorrow");
    expect(formatDueCountdown(due(2026, 7, 17), now)).toBe("Due in 5 days");
    expect(formatDueCountdown(due(2026, 7, 26), now)).toBe("Due in 2 weeks");
  });
});

describe("formatBackIn", () => {
  const now = localNoon(2026, 7, 12);

  it("says when a row that was put off comes back", () => {
    expect(formatBackIn(due(2026, 7, 13), now)).toBe("Back tomorrow");
    expect(formatBackIn(due(2026, 7, 15), now)).toBe("Back in 3 days");
    expect(formatBackIn(due(2026, 7, 26), now)).toBe("Back in 2 weeks");
  });
});

describe("formatComingIn", () => {
  const now = localNoon(2026, 7, 12);

  it("says when a row not on display yet arrives", () => {
    expect(formatComingIn(due(2026, 7, 13), now)).toBe("Tomorrow");
    expect(formatComingIn(due(2026, 7, 15), now)).toBe("In 3 days");
    expect(formatComingIn(due(2026, 8, 9), now)).toBe("In 4 weeks");
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

describe("recentOccurrence", () => {
  const today = at(2026, 7, 12);

  it("recurring: answers with the day just gone", () => {
    expect(recentOccurrence("birthday", parts(null, 7, 10), today, 2)).toEqual(
      at(2026, 7, 10),
    );
  });

  it("recurring: null once the occurrence is further back than the window", () => {
    expect(
      recentOccurrence("birthday", parts(null, 7, 9), today, 2),
    ).toBeNull();
  });

  it("recurring: today itself is not 'recent' — nextOccurrence owns it", () => {
    // Strictly before, so the forward and backward walks are disjoint and no
    // occurrence is ever considered twice in one reconcile.
    expect(
      recentOccurrence("birthday", parts(null, 7, 12), today, 2),
    ).toBeNull();
  });

  it("recurring: reaches back across the year boundary", () => {
    // The case that matters: a system reminder's id is keyed on the occurrence
    // year, so a New Year's Eve birthday read on New Year's Day has to answer
    // with **last** year's date or it would name a different reminder.
    expect(
      recentOccurrence("birthday", parts(null, 12, 31), at(2027, 1, 1), 2),
    ).toEqual(at(2026, 12, 31));
  });

  it("recurring: clamps Feb-29 the same way nextOccurrence does", () => {
    // The two must agree, or a leap-day reminder would be tombstoned and
    // re-minted under a new id the morning after it passed.
    expect(
      recentOccurrence("birthday", parts(1992, 2, 29), at(2027, 3, 1), 2),
    ).toEqual(at(2027, 2, 28));
  });

  it("one-time: answers with the event date while it is still recent", () => {
    expect(
      recentOccurrence("graduation", parts(2026, 7, 11), today, 2),
    ).toEqual(at(2026, 7, 11));
    expect(
      recentOccurrence("graduation", parts(2020, 5, 1), today, 2),
    ).toBeNull();
    // A future one-time event has not happened, so nothing is behind us.
    expect(
      recentOccurrence("graduation", parts(2026, 12, 1), today, 2),
    ).toBeNull();
  });

  it("one-time: null without a concrete year to place it", () => {
    expect(
      recentOccurrence("graduation", parts(null, 5, 1), today, 2),
    ).toBeNull();
  });

  it("returns null when there is no concrete day", () => {
    expect(
      recentOccurrence("birthday", parts(1992, null, null), today, 2),
    ).toBeNull();
  });
});
