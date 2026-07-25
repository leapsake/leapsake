import {
  type CivilDate,
  type RemindEligibleMilestone,
  type Reminder,
  type ReminderRuleInput,
  dueDateMs,
  mentionToken,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type ReminderEngineDeps,
  listSystemReminderTargets,
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
  // The person id that is "you", if any — drives the `isSelf` port so the
  // self-directed birthday wish branch can be exercised.
  let selfPersonId: string | null = null;
  // Per-milestone stored rule overrides; a milestone with no entry rides its
  // kind defaults, exactly as the real `resolveReminderSchedule` does over an
  // empty stored set.
  const schedules = new Map<string, ReminderRuleInput[]>();

  const deps: ReminderEngineDeps = {
    milestones: { listRemindEligible: async () => milestones },
    // A custom set is itself the resolved schedule; an un-set milestone rides its
    // kind defaults (what the real `resolveReminderSchedule` returns over no rows).
    resolveSchedule: async (m) =>
      schedules.get(m.id) ?? resolveReminderSchedule(m.kind, []),
    reminders: {
      getIncludingDeleted: async (id) => rows.get(id),
      insert: async (row) => {
        rows.set(row.id, row);
        return row;
      },
      // Refresh a live row's derived fields, bumping its clock, as the real repo
      // update does — leaving identity, completion, and tombstone state alone.
      update: async (id, fields) => {
        const row = rows.get(id);
        if (row)
          rows.set(id, { ...row, ...fields, updatedAt: row.updatedAt + 1 });
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
    isSelf: async (type, id) => type === "person" && id === selfPersonId,
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
    setSelf: (personId: string | null) => {
      selfPersonId = personId;
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

/** A remind-eligible death-anniversary milestone helper. */
function death(
  id: string,
  bearerId: string,
  occ: CivilDate,
): RemindEligibleMilestone {
  return {
    id,
    kind: "death",
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
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 });

    const [reminder] = h.activeSystem();
    expect(reminder.source).toBe("system");
    // A birthday's default schedule enables just the day-of "wish" action, whose
    // action-phrased copy wraps the subject in an inline mention token.
    expect(reminder.title).toBe(
      `🎉 Wish ${mentionToken("Alice", "person", "p1")} a happy birthday`,
    );
    expect(reminder.body).toBeNull();
    expect(reminder.completedAt).toBeNull();
    expect(reminder.dueDate).toBe(dueDateMs(daysOut(10)));
  });

  it("renders your own birthday's wish self-directed, with no @You mention", async () => {
    h.setSelf("p1"); // Alice is you
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 });

    const [reminder] = h.activeSystem();
    // Addressed to you — a celebratory icon and no mention token, not the
    // third-party "🎉 Wish @You a happy birthday".
    expect(reminder.title).toBe("🎂 It's your birthday!");
    expect(reminder.title).not.toContain("@[");
    // Still a real, dated reminder — you are not excluded, just re-worded.
    expect(reminder.dueDate).toBe(dueDateMs(daysOut(10)));
  });

  it("leaves a non-self birthday's wish unchanged when a self-person is set", async () => {
    h.setSelf("p2"); // someone else is you
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);

    await regenerateSystemReminders(h.deps);
    const [reminder] = h.activeSystem();
    expect(reminder.title).toBe(
      `🎉 Wish ${mentionToken("Alice", "person", "p1")} a happy birthday`,
    );
  });

  it("is idempotent: a second run adds no duplicate and keeps the id stable", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    await regenerateSystemReminders(h.deps);
    const firstId = h.activeSystem()[0].id;

    const second = await regenerateSystemReminders(h.deps);
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(1);
    expect(h.activeSystem()[0].id).toBe(firstId);
  });

  it("does not generate outside the lead window", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(40))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("removes a reminder when its milestone is gone", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(1);

    h.setMilestones([]); // milestone deleted
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 1 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("removes a reminder once its occurrence falls out of the window", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(1);

    h.setMilestones([birthday("m1", "p1", daysOut(40))]); // moved out of range
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 1 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("never resurrects a dismissed (tombstoned) reminder", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    await regenerateSystemReminders(h.deps);
    const id = h.activeSystem()[0].id;

    await h.deps.reminders.softDelete(id); // user dismissed it

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
    expect(h.rows.get(id)?.deletedAt).not.toBeNull();
  });

  it("re-dates a live reminder when its milestone's date drifts (same year, same id)", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(5))]);
    await regenerateSystemReminders(h.deps);
    const before = h.activeSystem()[0];
    expect(before.dueDate).toBe(dueDateMs(daysOut(5)));

    // Move the birthday later in the same window: the deterministic id is keyed on
    // the occurrence *year*, so it's unchanged — the row must be updated in place.
    h.setMilestones([birthday("m1", "p1", daysOut(12))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 1, removed: 0 });

    const after = h.activeSystem()[0];
    expect(after.id).toBe(before.id);
    expect(after.dueDate).toBe(dueDateMs(daysOut(12)));
  });

  it("re-titles a live reminder when its subject is renamed, keeping the id", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    await regenerateSystemReminders(h.deps);
    const id = h.activeSystem()[0].id;

    h.labels.set("p1", "Alicia"); // person renamed
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 1, removed: 0 });

    const after = h.activeSystem()[0];
    expect(after.id).toBe(id);
    expect(after.title).toBe(
      `🎉 Wish ${mentionToken("Alicia", "person", "p1")} a happy birthday`,
    );
  });

  it("preserves a manual completion when re-dating a live reminder", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(5))]);
    await regenerateSystemReminders(h.deps);
    const id = h.activeSystem()[0].id;
    // User marked the birthday reminder done, then the date is edited.
    h.rows.set(id, { ...h.rows.get(id)!, completedAt: 123 });

    h.setMilestones([birthday("m1", "p1", daysOut(12))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 1, removed: 0 });

    const after = h.activeSystem()[0];
    expect(after.dueDate).toBe(dueDateMs(daysOut(12)));
    expect(after.completedAt).toBe(123); // completion survives the re-date
  });

  it("ignores a kind whose default schedule is all-off (death)", async () => {
    // A death's only default rule ("remember") ships disabled, so an untouched
    // death milestone mints nothing — the quiet, opt-in posture.
    h.setMilestones([death("d1", "p1", daysOut(10))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
  });

  it("mints a reminder for a non-birthday kind once its rule is enabled", async () => {
    h.setMilestones([death("d1", "p1", daysOut(10))]);
    h.setSchedule("d1", [{ action: "remember", offsetDays: 0, enabled: true }]);

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(h.activeSystem()[0].title).toBe(
      `🕯️ Remember ${mentionToken("Alice", "person", "p1")}`,
    );
  });

  it("mints one reminder per enabled rule, each due at its own offset", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(20))]);
    h.setSchedule("m1", [
      { action: "gift", offsetDays: 30, enabled: true },
      { action: "wish", offsetDays: 0, enabled: true },
      { action: "text", offsetDays: 0, enabled: false }, // stays off
    ]);

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 2, updated: 0, removed: 0 });

    const byTitle = new Map(h.activeSystem().map((r) => [r.title, r]));
    const gift = byTitle.get(
      `🎁 Get ${mentionToken("Alice", "person", "p1")} a gift`,
    );
    const wish = byTitle.get(
      `🎉 Wish ${mentionToken("Alice", "person", "p1")} a happy birthday`,
    );
    expect(gift).toBeDefined();
    expect(wish).toBeDefined();
    // The gift is due 30 days before the birthday; the wish is due day-of.
    expect(gift?.dueDate).toBe(dueDateMs(daysOut(20)) - 30 * 86_400_000);
    expect(wish?.dueDate).toBe(dueDateMs(daysOut(20)));
    // Distinct occurrences → distinct ids (keyed on the action).
    expect(gift?.id).not.toBe(wish?.id);
  });

  it("surfaces a far-out rule before a nearer one (offset extends the window)", async () => {
    // 45 days out: the day-of wish is still beyond the 30-day window, but the
    // gift (due 30 days before) is already inside its own window.
    h.setMilestones([birthday("m1", "p1", daysOut(45))]);
    h.setSchedule("m1", [
      { action: "gift", offsetDays: 30, enabled: true },
      { action: "wish", offsetDays: 0, enabled: true },
    ]);

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(h.activeSystem()[0].title).toBe(
      `🎁 Get ${mentionToken("Alice", "person", "p1")} a gift`,
    );
  });

  it("uses the free-text label for an 'other' rule (no subject mention)", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(10))]);
    h.setSchedule("m1", [
      { action: "other", label: "Bring flowers", offsetDays: 0, enabled: true },
    ]);

    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()[0].title).toBe("🔔 Bring flowers");
  });

  it("skips a milestone whose bearer no longer resolves to a label", async () => {
    h.setMilestones([birthday("m1", "ghost", daysOut(10))]); // no label for "ghost"
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
  });
});

/**
 * What a system reminder is *about* — the read that lets a client offer an action
 * on it (a client turns the `gift` one into a link to the
 * recipient's gifts). It shares the reconcile's own walk, and the first test here
 * is the guard on that: the targets must name the very rows reconcile wrote.
 */
describe("listSystemReminderTargets", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
    h.labels.set("p1", "Alice");
  });

  it("names exactly the reminders a reconcile writes", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(20))]);
    h.setSchedule("m1", [
      { action: "wish", offsetDays: 0, enabled: true },
      { action: "gift", offsetDays: 30, enabled: true },
    ]);
    await regenerateSystemReminders(h.deps);

    const targets = await listSystemReminderTargets(h.deps);
    // Every written row is accounted for, and no target names a row that isn't
    // there — the drift guard: were the id derivation or the window filter to
    // fork between the two walks, this fails rather than silently dropping CTAs.
    expect(targets.map((t) => t.id).sort()).toEqual(
      h
        .activeSystem()
        .map((r) => r.id)
        .sort(),
    );
    expect(targets.map((t) => t.action).sort()).toEqual(["gift", "wish"]);
    for (const target of targets) {
      expect(target.bearerType).toBe("person");
      expect(target.bearerId).toBe("p1");
    }
  });

  it("keeps naming a gift reminder after it's completed", async () => {
    // The whole point of the completed-state CTA ("record what you gave"): a
    // manual completion doesn't change the desired set, so the target survives.
    h.setMilestones([birthday("m1", "p1", daysOut(20))]);
    h.setSchedule("m1", [{ action: "gift", offsetDays: 30, enabled: true }]);
    await regenerateSystemReminders(h.deps);
    const [row] = h.activeSystem();
    h.rows.set(row.id, { ...row, completedAt: Date.now() });

    const targets = await listSystemReminderTargets(h.deps);
    expect(targets.map((t) => t.id)).toEqual([row.id]);
  });

  it("omits a disabled action and a milestone outside its window", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(20))]);
    h.setSchedule("m1", [{ action: "gift", offsetDays: 0, enabled: false }]);
    expect(await listSystemReminderTargets(h.deps)).toEqual([]);
  });

  it("carries no target for an onboarding nudge", async () => {
    // Onboarding rows are dateless and about nobody; their CTA comes from the id
    // convention instead (`onboardingRouteOf`), so they must not appear here.
    h.setMilestones([]);
    const deps: ReminderEngineDeps = {
      ...h.deps,
      onboarding: {
        hasAnyEntity: async () => false,
        isSyncConnected: async () => false,
        hasSelf: async () => false,
      },
    };
    await regenerateSystemReminders(deps);
    expect(h.activeSystem().length).toBeGreaterThan(0);
    expect(await listSystemReminderTargets(deps)).toEqual([]);
  });

  it("writes nothing — it is a read", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(20))]);
    h.setSchedule("m1", [{ action: "gift", offsetDays: 30, enabled: true }]);
    await listSystemReminderTargets(h.deps);
    expect(h.activeSystem()).toEqual([]);
  });
});
