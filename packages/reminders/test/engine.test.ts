import {
  type CivilDate,
  type RemindEligibleMilestone,
  type Reminder,
  dueDateMs,
} from "@leapsake/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type ReminderEngineDeps,
  regenerateSystemReminders,
} from "../src/index.js";

/** A fixed local "today" for deterministic occurrence math. */
const TODAY: CivilDate = { year: 2026, month: 6, day: 1 };

/** The civil date `days` after {@link TODAY}, within the same month for simplicity. */
function daysOut(days: number): CivilDate {
  return { year: TODAY.year, month: TODAY.month, day: TODAY.day + days };
}

/**
 * An in-memory {@link SystemReminderStore} + the assembled {@link ReminderEngineDeps}
 * around a mutable milestone list and label map — the whole point of the separate
 * package: exercise the reconcile with no native sqlite driver.
 */
function makeHarness() {
  const rows = new Map<string, Reminder>();
  let milestones: RemindEligibleMilestone[] = [];
  const labels = new Map<string, string>();

  const deps: ReminderEngineDeps = {
    milestones: { listRemindEligible: async () => milestones },
    reminders: {
      getIncludingDeleted: async (id) => rows.get(id),
      insert: async (row) => {
        rows.set(row.id, row);
        return row;
      },
      // The engine only ever queries active system rows; the fake honours the
      // `source = ?` predicate and the active (not-tombstoned) filter.
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
    today: TODAY,
    transaction: (body) => body(),
  };

  return {
    deps,
    rows,
    labels,
    setMilestones: (next: RemindEligibleMilestone[]) => {
      milestones = next;
    },
    activeSystem: () =>
      [...rows.values()].filter(
        (r) => r.source === "system" && r.deletedAt === null,
      ),
  };
}

/** A remind-eligible birthday milestone helper. */
function birthday(
  id: string,
  bearerId: string,
  occ: CivilDate,
): RemindEligibleMilestone {
  return {
    id,
    kind: "birthday",
    bearerType: "person",
    bearerId,
    year: null,
    month: occ.month,
    day: occ.day,
  };
}

describe("regenerateSystemReminders", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
    h.labels.set("p1", "Alice");
  });

  it("creates a dated birthday reminder for an upcoming occurrence", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 1, removed: 0 });

    const [reminder] = h.activeSystem();
    expect(reminder.source).toBe("system");
    expect(reminder.title).toBe("🎂 Alice's birthday");
    expect(reminder.body).toBeNull();
    expect(reminder.completedAt).toBeNull();
    expect(reminder.dueDate).toBe(dueDateMs(daysOut(10)));
  });

  it("is idempotent: a second run adds no duplicate and keeps the id stable", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    await regenerateSystemReminders(h.deps);
    const firstId = h.activeSystem()[0].id;

    const second = await regenerateSystemReminders(h.deps);
    expect(second).toEqual({ created: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(1);
    expect(h.activeSystem()[0].id).toBe(firstId);
  });

  it("does not generate outside the lead window", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(40))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("removes a reminder when its milestone is gone", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(1);

    h.setMilestones([]); // milestone deleted
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, removed: 1 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("removes a reminder once its occurrence falls out of the window", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(1);

    h.setMilestones([birthday("m1", "p1", daysOut(40))]); // moved out of range
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, removed: 1 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("never resurrects a dismissed (tombstoned) reminder", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    await regenerateSystemReminders(h.deps);
    const id = h.activeSystem()[0].id;

    await h.deps.reminders.softDelete(id); // user dismissed it

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
    expect(h.rows.get(id)?.deletedAt).not.toBeNull();
  });

  it("ignores kinds that don't remind by default", async () => {
    h.setMilestones([
      {
        id: "d1",
        kind: "death",
        bearerType: "person",
        bearerId: "p1",
        year: null,
        month: daysOut(10).month,
        day: daysOut(10).day,
      },
    ]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, removed: 0 });
  });

  it("skips a milestone whose bearer no longer resolves to a label", async () => {
    h.setMilestones([birthday("m1", "ghost", daysOut(10))]); // no label for "ghost"
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
  });
});
