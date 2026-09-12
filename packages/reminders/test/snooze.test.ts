import { dueDateMs, todayCivil } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import { snoozeTargetOf } from "../src/index.js";

/**
 * "Remind me in…" — the one rule every snooze offer and every snooze write is
 * checked against. Any row, whatever made it; never one due today or belated;
 * never past its due date; and always to the start of a day.
 */

const DAY_MS = 86_400_000;

// A fixed local evening, so "tomorrow" has to mean the start of tomorrow and not
// this time tomorrow — the difference the rule exists to get right.
const NOW = Date.parse("2026-06-01T21:00:00");
const TODAY = dueDateMs(todayCivil(NOW));

const open = (dueDate: number | null = null) => ({
  completedAt: null,
  dueDate,
});

describe("snoozeTargetOf", () => {
  it("lands at the start of the day, not this time tomorrow", () => {
    expect(snoozeTargetOf(open(), 1, NOW)).toBe(TODAY + DAY_MS);
  });

  // Not a preset: a user-chosen duration later is a change to the offer alone.
  it("takes any whole number of days", () => {
    expect(snoozeTargetOf(open(), 3, NOW)).toBe(TODAY + 3 * DAY_MS);
    expect(snoozeTargetOf(open(), 12, NOW)).toBe(TODAY + 12 * DAY_MS);
  });

  it("refuses a day count that is not a positive whole number", () => {
    for (const days of [0, -1, 1.5, Number.NaN])
      expect(snoozeTargetOf(open(), days, NOW)).toBeNull();
  });

  it("puts a dateless row off as far as asked — it has no deadline", () => {
    expect(snoozeTargetOf(open(null), 30, NOW)).toBe(TODAY + 30 * DAY_MS);
  });

  // ⚠️ The due date is a real deadline — for a gift errand, the last day it
  // still has its full run-up — so a snooze may land on it but never after it.
  it("may land on the due date but never past it", () => {
    const due = TODAY + 3 * DAY_MS;
    expect(snoozeTargetOf(open(due), 3, NOW)).toBe(due);
    expect(snoozeTargetOf(open(due), 4, NOW)).toBeNull();
  });

  // Putting either off would only move it into belated, or deeper into it.
  it("refuses a row due today, and a belated one", () => {
    expect(snoozeTargetOf(open(TODAY), 1, NOW)).toBeNull();
    expect(snoozeTargetOf(open(TODAY - DAY_MS), 1, NOW)).toBeNull();
  });

  it("refuses a completed row", () => {
    expect(
      snoozeTargetOf({ completedAt: NOW, dueDate: null }, 1, NOW),
    ).toBeNull();
  });
});
