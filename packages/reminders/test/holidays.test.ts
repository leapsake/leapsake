import { deterministicUuid } from "@leapsake/crypto";
import {
  type CivilDate,
  type RemindEligibleMilestone,
  type Reminder,
  type ReminderRuleInput,
  dueDateMs,
  resolveObservanceReminderSchedule,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type HolidayOccurrenceCandidate,
  type ReminderEngineDeps,
  SYSTEM_REMINDER_NAMESPACE,
  regenerateSystemReminders,
} from "../src/index.js";

const TODAY: CivilDate = { year: 2026, month: 12, day: 1 };

/** As {@link makeHarness} in `engine.test.ts`, plus the holidays port. */
function makeHarness() {
  const rows = new Map<string, Reminder>();
  let candidates: HolidayOccurrenceCandidate[] = [];
  const labels = new Map<string, string>();
  const schedules = new Map<string, ReminderRuleInput[]>();

  const deps: ReminderEngineDeps = {
    milestones: {
      listRemindEligible: async (): Promise<RemindEligibleMilestone[]> => [],
    },
    resolveSchedule: async (m) => resolveReminderSchedule(m.kind, []),
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
    resolveLabel: async () => null,
    today: TODAY,
    transaction: (body) => body(),
    holidays: {
      listCandidates: async () => candidates,
      // Observances ship with **every** action off (holidays land all at once,
      // so a default-on wish would flood late November), which would make every
      // test below assert an empty store. So the harness stands in for a user
      // who has switched the day-of wish on; the real defaults are asserted
      // directly in "ships with every action off by default".
      resolveSchedule: async (c) =>
        schedules.get(c.observanceId) ?? [
          { action: "wish", label: null, offsetDays: 0, enabled: true },
        ],
      resolveLabel: async (_type, id) => labels.get(id) ?? null,
    },
  };

  return {
    deps,
    rows,
    labels,
    setCandidates: (next: HolidayOccurrenceCandidate[]) => {
      candidates = next;
    },
    setSchedule: (observanceId: string, rules: ReminderRuleInput[]) => {
      schedules.set(observanceId, rules);
    },
    activeSystem: () =>
      [...rows.values()].filter(
        (r) => r.source === "system" && r.deletedAt === null,
      ),
    titles: () =>
      [...rows.values()]
        .filter((r) => r.deletedAt === null)
        .map((r) => r.title)
        .sort(),
  };
}

const ALICE = "11111111-1111-4111-8111-111111111111";

function candidate(
  over: Partial<HolidayOccurrenceCandidate> = {},
): HolidayOccurrenceCandidate {
  return {
    observanceId: "obs-christmas-alice",
    greeting: "a Merry Christmas",
    bearerType: "person",
    bearerId: ALICE,
    occurrences: [{ year: 2026, month: 12, day: 25 }],
    ...over,
  };
}

describe("holiday reminders", () => {
  let h: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    h = makeHarness();
    h.labels.set(ALICE, "Alice Chen");
  });

  it("generates the occasion's own copy, not birthday copy", async () => {
    // The whole reason `template` takes a greeting: before this, `wish` was
    // hard-coded to "a happy birthday" and would have said so at Christmas.
    h.setCandidates([candidate()]);
    await regenerateSystemReminders(h.deps);

    expect(h.titles()).toEqual([
      "🎉 Wish @[Alice Chen](person:11111111-1111-4111-8111-111111111111) a Merry Christmas",
    ]);
  });

  it("keys its id on the occurrence date, not the year", async () => {
    // Ramadan fell twice in Gregorian 1997. Keying on the year — as milestone
    // reminders safely do — would collapse both onto one reminder.
    h.setCandidates([
      candidate({
        occurrences: [
          { year: 2026, month: 12, day: 5 },
          { year: 2026, month: 12, day: 25 },
        ],
      }),
    ]);
    await regenerateSystemReminders(h.deps);

    expect(h.activeSystem()).toHaveLength(2);
    const ids = h.activeSystem().map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(
      deterministicUuid(
        SYSTEM_REMINDER_NAMESPACE,
        "observance:obs-christmas-alice:2026-12-25:wish",
      ),
    );
  });

  it("uses a name-space disjoint from milestone and onboarding reminders", async () => {
    h.setCandidates([candidate()]);
    await regenerateSystemReminders(h.deps);
    const [row] = h.activeSystem();
    // A milestone id for the same subject and action must not collide.
    expect(row.id).not.toBe(
      deterministicUuid(
        SYSTEM_REMINDER_NAMESPACE,
        "milestone:obs-christmas-alice:2026:wish",
      ),
    );
  });

  it("is idempotent across reconciles", async () => {
    h.setCandidates([candidate()]);
    const first = await regenerateSystemReminders(h.deps);
    const second = await regenerateSystemReminders(h.deps);

    expect(first.created).toBe(1);
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
  });

  it("never resurrects a dismissed reminder", async () => {
    h.setCandidates([candidate()]);
    await regenerateSystemReminders(h.deps);
    const [row] = h.activeSystem();
    await h.deps.reminders.softDelete(row.id);

    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toEqual([]);
  });

  it("dismissing one occurrence leaves the next year's alone", async () => {
    // The date is part of the id, so a tombstone binds to one occurrence only —
    // "not this year" really does mean this year.
    h.setCandidates([candidate()]);
    await regenerateSystemReminders(h.deps);
    await h.deps.reminders.softDelete(h.activeSystem()[0].id);

    // Reconcile again a year on, when next Christmas is inside the window. The
    // store is shared, so the dismissal from 2026 is still present.
    h.setCandidates([
      candidate({ occurrences: [{ year: 2027, month: 12, day: 25 }] }),
    ]);
    await regenerateSystemReminders({
      ...h.deps,
      today: { year: 2027, month: 12, day: 1 },
    });

    expect(h.activeSystem()).toHaveLength(1);
  });

  it("honours a per-observance schedule, so leads differ per person", async () => {
    // §1's motivating case: the rule bears on the observance, so Alice can get a
    // gift reminder while Grandma only gets a call.
    h.setCandidates([candidate()]);
    h.setSchedule("obs-christmas-alice", [
      { action: "gift", label: null, offsetDays: 30, enabled: true },
      { action: "wish", label: null, offsetDays: 0, enabled: false },
    ]);
    await regenerateSystemReminders(h.deps);

    expect(h.titles()).toEqual([
      "🎁 Get @[Alice Chen](person:11111111-1111-4111-8111-111111111111) a gift",
    ]);
    // Due 30 days before the occurrence.
    expect(h.activeSystem()[0].dueDate).toBe(
      dueDateMs({ year: 2026, month: 11, day: 25 }),
    );
  });

  it("ships with every action off by default", async () => {
    // Unlike a birthday, an observance generates nothing until the user asks for
    // it: every Christmas observance comes due on the same day, so a default-on
    // wish would surface forty reminders at once for a forty-person address book.
    for (const rule of resolveObservanceReminderSchedule([])) {
      expect(rule.enabled).toBe(false);
    }

    h.setCandidates([candidate()]);
    h.setSchedule("obs-christmas-alice", resolveObservanceReminderSchedule([]));
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toEqual([]);
  });

  it("skips a disabled rule", async () => {
    h.setCandidates([candidate()]);
    h.setSchedule("obs-christmas-alice", [
      { action: "wish", label: null, offsetDays: 0, enabled: false },
    ]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toEqual([]);
  });

  it("skips an occurrence outside the lead window", async () => {
    h.setCandidates([
      candidate({ occurrences: [{ year: 2027, month: 6, day: 1 }] }),
    ]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toEqual([]);
  });

  it("skips a candidate whose bearer is gone", async () => {
    h.labels.delete(ALICE);
    h.setCandidates([candidate()]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toEqual([]);
  });

  it("generates nothing when the port is omitted", async () => {
    // Engine unit tests and any non-holiday caller may leave the port out.
    h.setCandidates([candidate()]);
    const { holidays: _omitted, ...withoutPort } = h.deps;
    await regenerateSystemReminders(withoutPort);
    expect(h.activeSystem()).toEqual([]);
  });

  it("lets a failure abort the reconcile without pruning anything", async () => {
    // The trap this guards: swallowing an error here would hand the reconcile a
    // desired set with no holiday rows, and the prune would tombstone every one
    // of them permanently. The desired set is built before the transaction
    // opens, so a throw must leave the store untouched.
    h.setCandidates([candidate()]);
    await regenerateSystemReminders(h.deps);
    const before = h.activeSystem().map((r) => r.id);
    expect(before).toHaveLength(1);

    const failing: ReminderEngineDeps = {
      ...h.deps,
      holidays: {
        ...h.deps.holidays!,
        listCandidates: async () => {
          throw new Error("repo unavailable");
        },
      },
    };
    await expect(regenerateSystemReminders(failing)).rejects.toThrow(
      /repo unavailable/,
    );

    expect(h.activeSystem().map((r) => r.id)).toEqual(before);
  });
});
