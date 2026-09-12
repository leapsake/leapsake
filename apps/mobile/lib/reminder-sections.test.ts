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
    /** The day a snooze runs to, where the row has been put off. */
    snoozedIn?: number;
    completedAt?: number | null;
  },
) => ({
  id,
  completedAt: dates.completedAt ?? null,
  dueDate: dayOut(dates.dueIn),
  snoozedUntil: dates.snoozedIn === undefined ? null : dayOut(dates.snoozedIn),
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
        // A gift errand on display for twelve days, due in six: on Today, known
        // by its countdown rather than by a section of its own.
        row("soon", { dueIn: 6, occurrenceIn: 18, activeIn: -12 }),
      ],
      { collapsed: none, now: NOW },
    );

    expect(items(list)).toEqual([
      "# belated",
      "late",
      "# today",
      "now",
      "soon",
    ]);
  });

  it("files a row not on Today yet under Next 7 days or Later, by the day it arrives", () => {
    const list = reminderListItems(
      [
        row("month", { dueIn: 25, occurrenceIn: 25, activeIn: 20 }),
        row("week", { dueIn: 10, occurrenceIn: 10, activeIn: 3 }),
      ],
      { collapsed: none, now: NOW },
    );

    expect(items(list)).toEqual([
      "note:owed",
      "# next7",
      "week",
      "# later",
      "month",
    ]);
  });

  it("files a row put off until tomorrow under Next 7 days", () => {
    const list = reminderListItems(
      [
        row("gift", {
          dueIn: 20,
          occurrenceIn: 32,
          activeIn: -10,
          snoozedIn: 1,
        }),
      ],
      { collapsed: none, now: NOW },
    );

    expect(items(list)).toEqual(["note:owed", "# next7", "gift"]);
    const gift = list.find((i) => i.kind === "row");
    expect(gift).toMatchObject({ section: "next7" });
  });

  it("keeps a collapsed section's heading and hides its rows", () => {
    const list = reminderListItems(
      [
        row("now", { dueIn: 0, occurrenceIn: 0 }),
        row("week", { dueIn: 10, occurrenceIn: 10, activeIn: 3 }),
      ],
      { collapsed: new Set(["next7"]), now: NOW },
    );

    expect(items(list)).toEqual(["# today", "now", "# next7"]);
    const header = list.find(
      (i) => i.kind === "header" && i.section === "next7",
    );
    expect(header).toMatchObject({
      count: 1,
      collapsible: true,
      collapsed: true,
    });
  });

  // *(owner, 2026-09-11)*: one closed section that opens twice.
  it("shows Later's heading only once Next 7 days is open", () => {
    const rows = [
      row("week", { dueIn: 10, occurrenceIn: 10, activeIn: 3 }),
      row("month", { dueIn: 25, occurrenceIn: 25, activeIn: 20 }),
    ];

    expect(
      items(
        reminderListItems(rows, {
          collapsed: new Set(["next7", "later"]),
          now: NOW,
        }),
      ),
    ).toEqual(["note:owed", "# next7"]);
    expect(
      items(
        reminderListItems(rows, { collapsed: new Set(["later"]), now: NOW }),
      ),
    ).toEqual(["note:owed", "# next7", "week", "# later"]);
  });

  it("lets Later stand on its own when nothing arrives in the next week", () => {
    const list = reminderListItems(
      [row("month", { dueIn: 25, occurrenceIn: 25, activeIn: 20 })],
      { collapsed: new Set(["next7", "later"]), now: NOW },
    );

    expect(items(list)).toEqual(["note:owed", "# later"]);
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

  it("says the day is done where the owed sections would have been", () => {
    const list = reminderListItems(
      [row("done", { dueIn: 0, occurrenceIn: 0, completedAt: NOW })],
      { collapsed: none, now: NOW },
    );

    expect(list[0]).toMatchObject({ kind: "note" });
  });

  it("says nothing at all when there are no reminders", () => {
    expect(reminderListItems([], { collapsed: none, now: NOW })).toEqual([]);
  });
});
