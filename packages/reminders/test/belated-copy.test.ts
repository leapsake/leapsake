import {
  type CivilDate,
  type RemindEligibleMilestone,
  type Reminder,
  type ReminderRuleInput,
  civilFromDueMs,
  dueDateMs,
  mentionToken,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type HolidayOccurrenceCandidate,
  type ReminderEngineDeps,
  DISPLAY_WINDOW_DAYS,
  getReminderInWindow,
  listNotifiableReminders,
  listRemindersInWindow,
  regenerateSystemReminders,
} from "../src/index.js";

/**
 * The copy a row **displays** is not always the copy it stores: once an occasion
 * has passed, the greeting is the belated one. These are the tests for that
 * split — that the derived half reaches every reader, and that the stored half
 * does not move when it happens.
 */

const TODAY: CivilDate = { year: 2026, month: 6, day: 1 };
const DAY_MS = 86_400_000;

/** `days` from {@link TODAY}; negative reaches into the past. */
function daysOut(days: number): CivilDate {
  return civilFromDueMs(dueDateMs(TODAY) + days * DAY_MS);
}

const VIOLET = mentionToken("Violet", "person", "p1");

/** As {@link makeHarness} in `engine.test.ts`, narrowed to what copy needs. */
function makeHarness() {
  const rows = new Map<string, Reminder>();
  let milestones: RemindEligibleMilestone[] = [];
  let today = TODAY;
  let selfPersonId: string | null = null;
  let candidates: HolidayOccurrenceCandidate[] = [];
  const labels = new Map<string, string>([["p1", "Violet"]]);
  const schedules = new Map<string, ReminderRuleInput[]>();

  const deps: ReminderEngineDeps = {
    milestones: { listRemindEligible: async () => milestones },
    resolveSchedule: async (m) => {
      const custom = schedules.get(m.id);
      return custom === undefined
        ? resolveReminderSchedule(m.kind, [])
        : { rules: custom, source: "stored" as const };
    },
    reminders: {
      getIncludingDeleted: async (id) => rows.get(id),
      insert: async (row) => {
        rows.set(row.id, row);
        return row;
      },
      update: async (id, fields) => {
        const row = rows.get(id);
        if (row)
          rows.set(id, { ...row, ...fields, updatedAt: row.updatedAt + 1 });
      },
      listWhere: async ({ params }) =>
        [...rows.values()].filter(
          (r) => r.source === params[0] && r.deletedAt === null,
        ),
      softDelete: async (id) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, deletedAt: Date.now() });
      },
    },
    resolveLabel: async (_type, id) => labels.get(id) ?? null,
    isSelf: async (type, id) => type === "person" && id === selfPersonId,
    holidays: {
      listCandidates: async () => candidates,
      resolveSchedule: async () => [
        { action: "wish", label: null, offsetDays: 0, enabled: true },
      ],
      resolveLabel: async (_type, id) => labels.get(id) ?? null,
    },
    get today() {
      return today;
    },
    transaction: (body) => body(),
  };

  return {
    deps,
    rows,
    setMilestones: (next: RemindEligibleMilestone[]) => {
      milestones = next;
    },
    setCandidates: (next: HolidayOccurrenceCandidate[]) => {
      candidates = next;
    },
    setSelf: (personId: string | null) => {
      selfPersonId = personId;
    },
    setToday: (next: CivilDate) => {
      today = next;
    },
    setSchedule: (milestoneId: string, rules: ReminderRuleInput[]) => {
      schedules.set(milestoneId, rules);
    },
    activeSystem: () =>
      [...rows.values()].filter(
        (r) => r.source === "system" && r.deletedAt === null,
      ),
  };
}

function milestone(
  id: string,
  kind: RemindEligibleMilestone["kind"],
  occ: CivilDate,
): RemindEligibleMilestone {
  return {
    id,
    kind,
    bearerType: "person",
    bearerId: "p1",
    year: null,
    month: occ.month,
    day: occ.day,
  };
}

/** A birthday whose only rule is the day-of wish, so a test reads one row. */
function wishOnly(h: ReturnType<typeof makeHarness>, occ: CivilDate) {
  h.setSchedule("m1", [{ action: "wish", offsetDays: 0, enabled: true }]);
  h.setMilestones([milestone("m1", "birthday", occ)]);
}

describe("belated copy", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("words a passed occasion belated on the read", async () => {
    wishOnly(h, daysOut(-1));
    await regenerateSystemReminders(h.deps);

    const [row] = await listRemindersInWindow(h.deps, DISPLAY_WINDOW_DAYS);
    expect(row.title).toBe(`🎉 Wish ${VIOLET} a happy belated birthday`);
  });

  it("stores the plain wording, whatever the read says", async () => {
    // The store must not hold a sentence that expires overnight: a client
    // reading the flat table months later should find copy that is still true
    // of the row, and the derivation is what makes it current.
    wishOnly(h, daysOut(-1));
    await regenerateSystemReminders(h.deps);

    expect(h.activeSystem()[0].title).toBe(
      `🎉 Wish ${VIOLET} a happy birthday`,
    );
  });

  it("does not rewrite the row when the occasion passes", async () => {
    // The whole reason the belated wording is derived. Were it stored, every
    // birthday would cost an update — and a sync — the morning after it.
    wishOnly(h, daysOut(0));
    expect(await regenerateSystemReminders(h.deps)).toEqual({
      created: 1,
      updated: 0,
      removed: 0,
    });

    h.setToday(daysOut(1));
    expect(await regenerateSystemReminders(h.deps)).toEqual({
      created: 0,
      updated: 0,
      removed: 0,
    });
  });

  it("keeps the plain wording while the occasion is still ahead", async () => {
    wishOnly(h, daysOut(0));
    await regenerateSystemReminders(h.deps);

    const [row] = await listRemindersInWindow(h.deps, DISPLAY_WINDOW_DAYS);
    expect(row.title).toBe(`🎉 Wish ${VIOLET} a happy birthday`);
  });

  it("reaches the notification planner's read too", async () => {
    // The one shared walk is the point: the screen and the planner cannot word
    // the same reminder differently, because there is only one place it is
    // worded.
    wishOnly(h, daysOut(-1));
    await regenerateSystemReminders(h.deps);

    const rows = await listNotifiableReminders(h.deps);
    expect(rows.find((r) => r.id === h.activeSystem()[0].id)?.title).toBe(
      `🎉 Wish ${VIOLET} a happy belated birthday`,
    );
  });

  it("leaves an action that names no greeting alone", async () => {
    // Only `wish` interpolates the greeting, so only `wish` changes. A gift is
    // a gift whether or not the birthday has gone.
    h.setSchedule("m1", [{ action: "get:gift", offsetDays: 0, enabled: true }]);
    h.setMilestones([milestone("m1", "birthday", daysOut(-1))]);
    await regenerateSystemReminders(h.deps);

    const [row] = await listRemindersInWindow(h.deps, DISPLAY_WINDOW_DAYS);
    expect(row.title).toBe(`🎁 Get ${VIOLET} a gift`);
  });

  it("keeps the plain greeting for an occasion that has no belated form", async () => {
    // A holiday's greeting is a stored column seeded from the catalog, so it
    // carries no belated variant — and "a belated Merry Christmas" is not worth
    // a migration yet. Absent means unchanged, deliberately: an odd-reading
    // greeting beats a mangled one.
    h.setCandidates([
      {
        observanceId: "o1",
        greeting: "a Merry Christmas",
        occasion: "Christmas",
        bearerType: "person",
        bearerId: "p1",
        occurrences: [daysOut(-1)],
      },
    ]);
    await regenerateSystemReminders(h.deps);

    const [row] = await listRemindersInWindow(h.deps, DISPLAY_WINDOW_DAYS);
    expect(row.title).toBe(`🎉 Wish ${VIOLET} a Merry Christmas`);
  });

  it("keeps the self-directed birthday in the right tense", async () => {
    // The self branch replaces the template outright, so it needs a belated form
    // of its own: the row lingers for a couple of days, and "It's your birthday!"
    // is simply false by then.
    h.setSelf("p1");
    wishOnly(h, daysOut(-1));
    await regenerateSystemReminders(h.deps);

    expect(h.activeSystem()[0].title).toBe("🎂 It's your birthday!");
    const [row] = await listRemindersInWindow(h.deps, DISPLAY_WINDOW_DAYS);
    expect(row.title).toBe("🎂 It was your birthday!");
  });
});

describe("getReminderInWindow", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("answers with the row as the list sees it", async () => {
    // What a detail screen reads. Reading the stored row instead would word the
    // screen differently from the row that linked to it.
    wishOnly(h, daysOut(-1));
    await regenerateSystemReminders(h.deps);
    const id = h.activeSystem()[0].id;

    const row = await getReminderInWindow(h.deps, id);
    expect(row?.title).toBe(`🎉 Wish ${VIOLET} a happy belated birthday`);
    expect(row?.occurrenceDate).toBe(dueDateMs(daysOut(-1)));
    expect(row?.materialized).toBe(true);
  });

  it("answers undefined for an id the walk does not want", async () => {
    // A stale link, or a system row whose window has closed. The caller falls
    // back to the stored row rather than showing nothing.
    expect(await getReminderInWindow(h.deps, "no-such-id")).toBeUndefined();
  });
});
