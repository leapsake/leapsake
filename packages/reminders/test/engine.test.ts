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
  type ReminderEngineDeps,
  listNotifiableReminders,
  listSystemReminderTargets,
  regenerateSystemReminders,
} from "../src/index.js";

/** A fixed local "today" for deterministic occurrence math. */
const TODAY: CivilDate = { year: 2026, month: 6, day: 1 };

/** The civil date `days` from {@link TODAY} — **negative reaches into the past**,
 *  which the belated cases need. Built on the stored-due-date round-trip rather
 *  than by adding to `day`, so month and year boundaries roll properly. */
function daysOut(days: number): CivilDate {
  return civilFromDueMs(dueDateMs(TODAY) + days * 86_400_000);
}

/**
 * An in-memory {@link SystemReminderStore} + the assembled {@link ReminderEngineDeps}
 * around a mutable milestone list and label map — the whole point of the separate
 * package: exercise the reconcile with no native sqlite driver.
 */
function makeHarness() {
  const rows = new Map<string, Reminder>();
  // Mutable so a test can advance the clock past an occurrence — the only way to
  // exercise the belated tail without also editing the milestone, which would
  // read as a date drift and re-date the row.
  let today: CivilDate = TODAY;
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
    get today() {
      return today;
    },
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

  it("creates a dated birthday reminder on the day itself", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);

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
    expect(reminder.dueDate).toBe(dueDateMs(daysOut(0)));
  });

  it("says nothing about a birthday that is merely coming", async () => {
    // The complaint this whole rework started on: every birthday in the next
    // month used to sit on Home all month. `wish` is `activeDays: 0`, so it
    // arrives on the morning it is owed and not a day sooner — not tomorrow's,
    // and certainly not a fortnight's.
    h.setMilestones([
      birthday("m1", "p1", daysOut(1)),
      birthday("m2", "p1", daysOut(14)),
    ]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("renders your own birthday's wish self-directed, with no @You mention", async () => {
    h.setSelf("p1"); // Alice is you
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 });

    const [reminder] = h.activeSystem();
    // Addressed to you — a celebratory icon and no mention token, not the
    // third-party "🎉 Wish @You a happy birthday".
    expect(reminder.title).toBe("🎂 It's your birthday!");
    expect(reminder.title).not.toContain("@[");
    // Still a real, dated reminder — you are not excluded, just re-worded.
    expect(reminder.dueDate).toBe(dueDateMs(daysOut(0)));
  });

  it("leaves a non-self birthday's wish unchanged when a self-person is set", async () => {
    h.setSelf("p2"); // someone else is you
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);

    await regenerateSystemReminders(h.deps);
    const [reminder] = h.activeSystem();
    expect(reminder.title).toBe(
      `🎉 Wish ${mentionToken("Alice", "person", "p1")} a happy birthday`,
    );
  });

  it("is idempotent: a second run adds no duplicate and keeps the id stable", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
    await regenerateSystemReminders(h.deps);
    const firstId = h.activeSystem()[0].id;

    const second = await regenerateSystemReminders(h.deps);
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(1);
    expect(h.activeSystem()[0].id).toBe(firstId);
  });

  it("does not generate outside the action's own window", async () => {
    // A gift is a project — 30 days of run-up, due 12 days out, so it lands 42
    // days ahead. One day earlier than that is one day too early.
    h.setMilestones([birthday("m1", "p1", daysOut(43))]);
    h.setSchedule("m1", [{ action: "gift", offsetDays: 12, enabled: true }]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);

    // ...and 42 days out it appears, still a fortnight from being due.
    h.setMilestones([birthday("m1", "p1", daysOut(42))]);
    expect(await regenerateSystemReminders(h.deps)).toEqual({
      created: 1,
      updated: 0,
      removed: 0,
    });
  });

  it("removes a reminder when its milestone is gone", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(1);

    h.setMilestones([]); // milestone deleted
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 1 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("removes a reminder once its occurrence falls out of the window", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(1);

    h.setMilestones([birthday("m1", "p1", daysOut(40))]); // moved out of range
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 1 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("never resurrects a dismissed (tombstoned) reminder", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
    await regenerateSystemReminders(h.deps);
    const id = h.activeSystem()[0].id;

    await h.deps.reminders.softDelete(id); // user dismissed it

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
    expect(h.rows.get(id)?.deletedAt).not.toBeNull();
  });

  it("re-dates a live reminder when its milestone's date drifts (same year, same id)", async () => {
    // `visit` — day-of, but a week of run-up — so both dates are in window and
    // the drift is visible. A day-of `wish` has no window to drift within.
    h.setSchedule("m1", [{ action: "visit", offsetDays: 0, enabled: true }]);
    h.setMilestones([birthday("m1", "p1", daysOut(3))]);
    await regenerateSystemReminders(h.deps);
    const before = h.activeSystem()[0];
    expect(before.dueDate).toBe(dueDateMs(daysOut(3)));

    // Move the birthday later in the same window: the deterministic id is keyed on
    // the occurrence *year*, so it's unchanged — the row must be updated in place.
    h.setMilestones([birthday("m1", "p1", daysOut(6))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 1, removed: 0 });

    const after = h.activeSystem()[0];
    expect(after.id).toBe(before.id);
    expect(after.dueDate).toBe(dueDateMs(daysOut(6)));
  });

  it("re-titles a live reminder when its subject is renamed, keeping the id", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
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
    h.setSchedule("m1", [{ action: "visit", offsetDays: 0, enabled: true }]);
    h.setMilestones([birthday("m1", "p1", daysOut(3))]);
    await regenerateSystemReminders(h.deps);
    const id = h.activeSystem()[0].id;
    // User marked the birthday reminder done, then the date is edited.
    h.rows.set(id, { ...h.rows.get(id)!, completedAt: 123 });

    h.setMilestones([birthday("m1", "p1", daysOut(6))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 1, removed: 0 });

    const after = h.activeSystem()[0];
    expect(after.dueDate).toBe(dueDateMs(daysOut(6)));
    expect(after.completedAt).toBe(123); // completion survives the re-date
  });

  it("ignores a kind whose default schedule is all-off (death)", async () => {
    // A death's only default rule ("remember") ships disabled, so an untouched
    // death milestone mints nothing — the quiet, opt-in posture.
    h.setMilestones([death("d1", "p1", daysOut(0))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
  });

  it("mints a reminder for a non-birthday kind once its rule is enabled", async () => {
    h.setMilestones([death("d1", "p1", daysOut(0))]);
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
      { action: "gift", offsetDays: 12, enabled: true },
      { action: "card", offsetDays: 7, enabled: true },
      { action: "text", offsetDays: 0, enabled: false }, // stays off
    ]);

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 2, updated: 0, removed: 0 });

    const byTitle = new Map(h.activeSystem().map((r) => [r.title, r]));
    const gift = byTitle.get(
      `🎁 Get ${mentionToken("Alice", "person", "p1")} a gift`,
    );
    const card = byTitle.get(
      `💌 Send ${mentionToken("Alice", "person", "p1")} a card`,
    );
    expect(gift).toBeDefined();
    expect(card).toBeDefined();
    // Each is due its own lead time before the birthday.
    expect(gift?.dueDate).toBe(dueDateMs(daysOut(20)) - 12 * 86_400_000);
    expect(card?.dueDate).toBe(dueDateMs(daysOut(20)) - 7 * 86_400_000);
    // Distinct actions → distinct ids.
    expect(gift?.id).not.toBe(card?.id);
  });

  it("surfaces a long errand well before a short one", async () => {
    // 40 days out. The gift has 30 days of run-up before a due date 12 days
    // ahead of the birthday, so it is already on display; the card's fortnight
    // and the wish's day-of are both still in the future. This is the whole
    // point of `activeDays`: three actions on one birthday, three arrival dates.
    h.setMilestones([birthday("m1", "p1", daysOut(40))]);
    h.setSchedule("m1", [
      { action: "gift", offsetDays: 12, enabled: true },
      { action: "card", offsetDays: 7, enabled: true },
      { action: "wish", offsetDays: 0, enabled: true },
    ]);

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(h.activeSystem()[0].title).toBe(
      `🎁 Get ${mentionToken("Alice", "person", "p1")} a gift`,
    );
  });

  it("keeps a missed reminder as belated for a couple of days", async () => {
    // Yesterday's birthday. The old engine dropped a reminder the morning after
    // its day, so you never learned you had missed it; now it lingers, with a
    // due date honestly in the past.
    h.setMilestones([birthday("m1", "p1", daysOut(-1))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(h.activeSystem()[0].dueDate).toBe(dueDateMs(daysOut(-1)));
  });

  it("retires a belated reminder once its tail runs out", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(-3))]);
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("carries a reminder's identity and completion across its own occurrence", async () => {
    // The id is keyed on the occurrence *year*, and `recentOccurrence` answers
    // with the year the reminder was minted under — so the row the user already
    // ticked is the same row that goes belated, not a fresh one.
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
    await regenerateSystemReminders(h.deps);
    const [before] = h.activeSystem();
    h.rows.set(before.id, { ...before, completedAt: 123 });

    // The next morning. Nothing about the milestone changed — only the day.
    h.setToday(daysOut(1));
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });

    const [after] = h.activeSystem();
    expect(after.id).toBe(before.id);
    expect(after.completedAt).toBe(123);
  });

  it("holds a past-due errand open until the occasion itself", async () => {
    // The card's post date blew four days ago, but the birthday is on Thursday
    // — still salvageable, so it stays. The aliveness test closes on the
    // occurrence, deliberately, not on the rule's own deadline.
    h.setMilestones([birthday("m1", "p1", daysOut(3))]);
    h.setSchedule("m1", [{ action: "card", offsetDays: 7, enabled: true }]);

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 });
    const [row] = h.activeSystem();
    expect(row.dueDate).toBe(dueDateMs(daysOut(3)) - 7 * 86_400_000);
    expect(row.dueDate).toBeLessThan(dueDateMs(TODAY)); // past due, still alive
  });

  it("uses the free-text label for an 'other' rule (no subject mention)", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
    h.setSchedule("m1", [
      { action: "other", label: "Bring flowers", offsetDays: 0, enabled: true },
    ]);

    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()[0].title).toBe("🔔 Bring flowers");
  });

  it("skips a milestone whose bearer no longer resolves to a label", async () => {
    h.setMilestones([birthday("m1", "ghost", daysOut(0))]); // no label for "ghost"
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
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
    h.setSchedule("m1", [
      { action: "wish", offsetDays: 0, enabled: true },
      { action: "gift", offsetDays: 12, enabled: true },
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
    h.setSchedule("m1", [{ action: "gift", offsetDays: 12, enabled: true }]);
    await regenerateSystemReminders(h.deps);
    const [row] = h.activeSystem();
    h.rows.set(row.id, { ...row, completedAt: Date.now() });

    const targets = await listSystemReminderTargets(h.deps);
    expect(targets.map((t) => t.id)).toEqual([row.id]);
  });

  it("omits a disabled action and one outside its window", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(20))]);
    h.setSchedule("m1", [
      { action: "gift", offsetDays: 12, enabled: false }, // would be in window
      { action: "wish", offsetDays: 0, enabled: true }, // enabled, not yet due
    ]);
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
        hasAccount: async () => false,
      },
    };
    await regenerateSystemReminders(deps);
    expect(h.activeSystem().length).toBeGreaterThan(0);
    expect(await listSystemReminderTargets(deps)).toEqual([]);
  });

  it("writes nothing — it is a read", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(20))]);
    h.setSchedule("m1", [{ action: "gift", offsetDays: 12, enabled: true }]);
    await listSystemReminderTargets(h.deps);
    expect(h.activeSystem()).toEqual([]);
  });
});

/**
 * The notification planner's input. Its whole reason to exist is that a
 * `system` reminder is not a row until its own action puts it on display — the
 * day itself, for a wish — so planning from stored rows alone could barely
 * schedule anything, and that horizon advances only when the app is opened,
 * which is precisely what a notification exists to spare the user.
 */
describe("listNotifiableReminders", () => {
  /** ~183 days out: far past any action's window, comfortably inside the year. */
  const FAR: CivilDate = { year: 2026, month: 12, day: 1 };

  it("sees milestones that regenerate would not yet materialize", async () => {
    const h = makeHarness();
    h.setMilestones([birthday("m1", "p1", FAR)]);
    h.labels.set("p1", "Alice");

    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toEqual([]); // beyond the row horizon

    const notifiable = await listNotifiableReminders(h.deps);
    expect(notifiable).toHaveLength(1);
    expect(notifiable[0].dueDate).toBe(dueDateMs(FAR));
  });

  // Widening the *row* horizon instead would flood the reminder list with a
  // year of future rows and sync them to every device.
  it("persists nothing", async () => {
    const h = makeHarness();
    h.setMilestones([birthday("m1", "p1", FAR)]);
    h.labels.set("p1", "Alice");

    await listNotifiableReminders(h.deps);

    expect([...h.rows.values()]).toEqual([]);
  });

  // Planning off a synthesized copy would re-notify for something already
  // dealt with, so a materialized row wins over the computed one.
  it("returns the real row, with its state, when one exists", async () => {
    const h = makeHarness();
    const today = daysOut(0);
    h.setMilestones([birthday("m1", "p1", today)]);
    h.labels.set("p1", "Alice");
    await regenerateSystemReminders(h.deps);

    const [row] = h.activeSystem();
    h.rows.set(row.id, { ...row, completedAt: 123 });

    const notifiable = await listNotifiableReminders(h.deps);

    expect(notifiable).toHaveLength(1);
    expect(notifiable[0].completedAt).toBe(123);
  });

  // The same resurrection guard `reconcile` applies: a dismissed reminder must
  // not come back as a notification. Its id stays in the desired set until the
  // occurrence passes, so this is the common case, not an edge one.
  it("skips a dismissed (tombstoned) reminder", async () => {
    const h = makeHarness();
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
    h.labels.set("p1", "Alice");
    await regenerateSystemReminders(h.deps);

    const [row] = h.activeSystem();
    h.rows.set(row.id, { ...row, deletedAt: Date.now() });

    expect(await listNotifiableReminders(h.deps)).toEqual([]);
  });

  // User reminders are rows the moment they are created, at any due date, so
  // they need none of the prospective machinery — but must still be included.
  it("includes user reminders alongside the computed system ones", async () => {
    const h = makeHarness();
    h.setMilestones([birthday("m1", "p1", FAR)]);
    h.labels.set("p1", "Alice");
    h.rows.set("u1", {
      id: "u1",
      title: "Book flights",
      body: null,
      completedAt: null,
      dueDate: dueDateMs(daysOut(3)),
      snoozedUntil: null,
      snoozeCount: 0,
      source: "user",
      createdAt: 0,
      updatedAt: 0,
      deletedAt: null,
    });

    const notifiable = await listNotifiableReminders(h.deps);

    expect(notifiable.map((r) => r.source).sort()).toEqual(["system", "user"]);
  });

  // The window is a parameter so the two callers can ask different questions of
  // the same walk: one uniform horizon here, each action's own window there.
  it("narrows to a shorter horizon when asked for one", async () => {
    const h = makeHarness();
    h.setMilestones([birthday("m1", "p1", FAR)]);
    h.labels.set("p1", "Alice");

    expect(await listNotifiableReminders(h.deps, 30)).toEqual([]);
    expect(await listNotifiableReminders(h.deps, 365)).toHaveLength(1);
  });
});
