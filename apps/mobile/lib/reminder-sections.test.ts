import { dueDateMs, todayCivil } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  type ReminderListItem,
  type ReminderSection,
  reminderListItems,
} from "./reminder-sections";

// A fixed local noon, so "today" is the same civil day whatever the machine's
// timezone; every date is derived from it through the stored-due-date round-trip.
const NOW = Date.parse("2026-06-01T12:00:00");
const dayOut = (n: number) => dueDateMs(todayCivil(NOW)) + n * 86_400_000;

const row = (
  id: string,
  dates: {
    dueIn: number;
    occurrenceIn?: number;
    activeIn?: number;
    completedAt?: number | null;
  },
) => ({
  id,
  completedAt: dates.completedAt ?? null,
  dueDate: dayOut(dates.dueIn),
  snoozedUntil: null,
  createdAt: 0,
  activeFrom: dayOut(dates.activeIn ?? dates.dueIn),
  occurrenceDate:
    dates.occurrenceIn === undefined ? null : dayOut(dates.occurrenceIn),
});

const none = new Set<ReminderSection>();
const items = <R>(list: readonly ReminderListItem<R>[]) =>
  list.map((i) => (i.kind === "header" ? `# ${i.section}` : i.id));

describe("reminderListItems", () => {
  it("heads each non-empty section and skips the empty ones", () => {
    const list = reminderListItems(
      [
        row("late", { dueIn: -2, occurrenceIn: 3 }),
        row("now", { dueIn: 0, occurrenceIn: 0 }),
        row("soon", { dueIn: 6, occurrenceIn: 18, activeIn: -12 }),
      ],
      { collapsed: none, now: NOW },
    );

    // No coming or completed rows, so no headings for them. An overdue row
    // whose occasion is still ahead is belated too — one section, not two.
    expect(items(list)).toEqual([
      "# belated",
      "late",
      "# today",
      "now",
      "# available",
      "soon",
    ]);
  });

  it("keeps a collapsed section's heading and hides its rows", () => {
    const list = reminderListItems(
      [
        row("now", { dueIn: 0, occurrenceIn: 0 }),
        row("later", { dueIn: 25, occurrenceIn: 25 }),
      ],
      { collapsed: new Set(["coming"]), now: NOW },
    );

    expect(items(list)).toEqual(["# today", "now", "# coming"]);
    const header = list.find(
      (i) => i.kind === "header" && i.section === "coming",
    );
    expect(header).toMatchObject({
      count: 1,
      collapsible: true,
      collapsed: true,
    });
  });

  it("files a completed row under done, out of the section it was in", () => {
    const list = reminderListItems(
      [
        row("a", { dueIn: 0, occurrenceIn: 0, completedAt: NOW }),
        row("b", { dueIn: 0, occurrenceIn: 0 }),
      ],
      { collapsed: none, now: NOW },
    );

    expect(items(list)).toEqual(["# today", "b", "# done", "a"]);
  });

  it("says the day is clear where the owed sections would have been", () => {
    const list = reminderListItems(
      [row("gift", { dueIn: 9, occurrenceIn: 21, activeIn: -21 })],
      { collapsed: none, now: NOW },
    );

    expect(list[0]).toMatchObject({ kind: "note", allClear: false });
    expect(items(list.slice(1))).toEqual(["# available", "gift"]);
  });

  it("distinguishes nothing owed from nothing left at all", () => {
    const list = reminderListItems(
      [row("done", { dueIn: 0, occurrenceIn: 0, completedAt: NOW })],
      { collapsed: none, now: NOW },
    );

    expect(list[0]).toMatchObject({ kind: "note", allClear: true });
  });

  it("says nothing at all when there are no reminders", () => {
    expect(reminderListItems([], { collapsed: none, now: NOW })).toEqual([]);
  });
});
