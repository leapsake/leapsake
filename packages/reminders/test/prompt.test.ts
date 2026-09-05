import { deterministicUuid } from "@leapsake/bytes";
import {
  type CivilDate,
  type MilestoneKind,
  type RemindEligibleMilestone,
  type Reminder,
  type ReminderRuleInput,
  actionDefs,
  civilFromDueMs,
  dueDateMs,
  mentionToken,
  promptOffsetDays,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DISPLAY_WINDOW_DAYS,
  type ReminderEngineDeps,
  SYSTEM_REMINDER_NAMESPACE,
  listRemindersInWindow,
  regenerateSystemReminders,
  snoozePolicyOf,
} from "../src/index.js";

const TODAY: CivilDate = { year: 2026, month: 6, day: 1 };
const DAY_MS = 86_400_000;

/** `days` from {@link TODAY}; negative reaches into the past. */
function daysOut(days: number): CivilDate {
  return civilFromDueMs(dueDateMs(TODAY) + days * DAY_MS);
}

/**
 * The distances that matter, derived rather than written down, so that moving a
 * number in `actionDefs` moves this file with it instead of breaking it.
 */
const DUE_DAYS = promptOffsetDays("birthday"); // 42 today: gift's 12 + 30
const ACTIVE_DAYS = actionDefs.plan.activeDays; // 14
const APPEARS_DAYS = DUE_DAYS + ACTIVE_DAYS; // 56 — eight weeks

/** As {@link makeHarness} in `engine.test.ts`, narrowed to what a prompt needs. */
function makeHarness() {
  const rows = new Map<string, Reminder>();
  let milestones: RemindEligibleMilestone[] = [];
  let today = TODAY;
  let selfPersonId: string | null = null;
  const labels = new Map<string, string>([["p1", "Alice"]]);
  const schedules = new Map<string, ReminderRuleInput[]>();

  const deps: ReminderEngineDeps = {
    milestones: { listRemindEligible: async () => milestones },
    // A set schedule stands in for stored rule rows, so it reads as `stored` and
    // must suppress the prompt exactly as real rows do.
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
    isSelf: async (_type, id) => id === selfPersonId,
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
    setSchedule: (milestoneId: string, rules: ReminderRuleInput[]) => {
      schedules.set(milestoneId, rules);
    },
    setSelf: (personId: string | null) => {
      selfPersonId = personId;
    },
    setToday: (next: CivilDate) => {
      today = next;
    },
    activeSystem: () =>
      [...rows.values()].filter(
        (r) => r.source === "system" && r.deletedAt === null,
      ),
    prompts: () =>
      [...rows.values()].filter(
        (r) => r.deletedAt === null && r.title?.startsWith("🗓") === true,
      ),
  };
}

function milestone(
  id: string,
  kind: MilestoneKind,
  bearerId: string,
  occ: CivilDate,
): RemindEligibleMilestone {
  return {
    id,
    kind,
    bearerType: "person",
    bearerId,
    year: null,
    month: occ.month,
    day: occ.day,
  };
}

const birthday = (id: string, bearerId: string, occ: CivilDate) =>
  milestone(id, "birthday", bearerId, occ);

describe("the plan prompt", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  // Eight weeks, and not a day sooner. The number is derived from what the
  // question offers, so this asserts the derivation rather than the literal.
  it("appears its full lead ahead of the occasion, and not before", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS + 1))]);
    expect(await regenerateSystemReminders(h.deps)).toEqual({
      created: 0,
      updated: 0,
      removed: 0,
    });

    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS))]);
    expect(await regenerateSystemReminders(h.deps)).toEqual({
      created: 1,
      updated: 0,
      removed: 0,
    });

    const [prompt] = h.prompts();
    expect(prompt.title).toBe(
      `🗓 How do you want to mark ${mentionToken("Alice", "person", "p1")}'s birthday?`,
    );
    // Due six weeks out — the last day on which ticking "get a gift" still
    // leaves the gift its full 30-day run-up.
    expect(prompt.dueDate).toBe(
      dueDateMs(daysOut(APPEARS_DAYS)) - DUE_DAYS * DAY_MS,
    );
    // ⚠️ No distance baked into the copy: the row's countdown is rendered from
    // its due date (`formatDueIn`), and a written-in "in two months" is wrong by
    // tomorrow. Asserted against the template rather than the rendered row,
    // whose mention token carries digits of its own.
    expect(
      actionDefs.plan.template({
        subject: "Alice",
        greeting: "a happy birthday",
        occasion: "birthday",
      }),
    ).not.toMatch(/\d|week|month/);
  });

  it("is content-addressed as `milestone:<id>:<year>:plan`", async () => {
    const occ = daysOut(APPEARS_DAYS);
    h.setMilestones([birthday("m1", "p1", occ)]);
    await regenerateSystemReminders(h.deps);

    expect(h.prompts()[0].id).toBe(
      deterministicUuid(
        SYSTEM_REMINDER_NAMESPACE,
        `milestone:m1:${occ.year}:plan`,
      ),
    );
  });

  // Rows existing is the "answered" marker — no new column.
  it("is not minted once the occasion has rules of its own", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS))]);
    h.setSchedule("m1", [{ action: "wish", offsetDays: 0, enabled: true }]);

    await regenerateSystemReminders(h.deps);
    expect(h.prompts()).toHaveLength(0);
  });

  // ⚠️ Ticking nothing has to be distinguishable from never being asked, or the
  // question returns every year. The answer writes the *full* offer set,
  // disabled rows included, so an all-off set still counts as answered.
  it("is not minted for an answer of `nothing`", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS))]);
    h.setSchedule("m1", [
      { action: "get:gift", offsetDays: 12, enabled: false },
      { action: "wish", offsetDays: 0, enabled: false },
    ]);

    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(0);
  });

  // A checkbox list of ways to recognise a death anniversary is exactly the
  // wrong object; its single quiet "remember" is already right.
  it("is never minted for a death", async () => {
    h.setMilestones([milestone("d1", "death", "p1", daysOut(APPEARS_DAYS))]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(0);
  });

  // An ignored prompt is not silence: the occasion still rides its kind
  // defaults, so you never lose the birthday.
  it("leaves the day-of wish standing when it is ignored", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(0))]);
    await regenerateSystemReminders(h.deps);

    const titles = h.activeSystem().map((r) => r.title);
    expect(titles).toContain(
      `🎉 Wish ${mentionToken("Alice", "person", "p1")} a happy birthday`,
    );
    expect(h.prompts()).toHaveLength(1);
  });

  // The window closes on the *occurrence*, not on the prompt's own deadline, so
  // a late answer still works — the chosen actions simply materialise with
  // compressed windows, which is honest.
  it("survives its own deadline, and retires on the belated tail", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS))]);
    await regenerateSystemReminders(h.deps);
    const id = h.prompts()[0].id;

    // A fortnight after it came due, with the birthday still a month away.
    h.setToday(daysOut(ACTIVE_DAYS + 14));
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()[0].id).toBe(id); // same row, past due

    // The morning after the birthday: still answerable, briefly.
    h.setToday(daysOut(APPEARS_DAYS + 1));
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()).toHaveLength(1);

    // And then gone.
    h.setToday(daysOut(APPEARS_DAYS + 5));
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()).toHaveLength(0);
  });

  // Same branch, same reason as the birthday wish: keyed on a fact about the
  // bearer, never on identity — the row is still `...:plan`.
  it("addresses your own occasion to you", async () => {
    h.setSelf("p1");
    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS))]);
    await regenerateSystemReminders(h.deps);

    expect(h.prompts()[0].title).toBe(
      "🗓 How do you want to mark your own birthday?",
    );
    expect(h.prompts()[0].title).not.toContain("@[");
  });

  // ⚠️ The list read substitutes one uniform horizon for every action, so it has
  // to want the prompt at least as early as the materialization walk mints it —
  // otherwise a row that exists, and is on display by its own rule, is nowhere
  // to be seen.
  it("is inside the list's horizon wherever it is a row", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS))]);
    await regenerateSystemReminders(h.deps);

    const rows = await listRemindersInWindow(h.deps, DISPLAY_WINDOW_DAYS);
    expect(rows.map((r) => r.id)).toContain(h.prompts()[0].id);
  });
});

describe("snoozePolicyOf, for a prompt", () => {
  const NOW = dueDateMs(TODAY) + 9 * 60 * 60 * 1000; // 9am today
  const prompt = (over: { snoozeCount?: number; dueDate?: number } = {}) => ({
    id: "not-an-onboarding-id",
    snoozeCount: 0,
    isPlanPrompt: true,
    ...over,
  });

  it("offers nothing to an ordinary reminder", () => {
    expect(snoozePolicyOf({ id: "whatever", snoozeCount: 0 }, NOW)).toBeNull();
  });

  // ⚠️ The due date is a real deadline, not a preference: a plain week's "not
  // now" offered before it would silently forfeit the long-lead options. So the
  // first one lands exactly on the deadline instead.
  it("clamps to the due date while the deadline is still ahead", () => {
    const dueDate = NOW + 3 * DAY_MS;
    expect(snoozePolicyOf(prompt({ dueDate }), NOW)).toEqual({
      until: dueDate,
    });
  });

  // Past it there is nothing left to protect, and the only thing that matters is
  // keeping the question answerable to the occurrence.
  it("snoozes the full period once the deadline has passed", () => {
    const dueDate = NOW - 3 * DAY_MS;
    const policy = snoozePolicyOf(prompt({ dueDate }), NOW);
    expect(policy?.until).toBe(NOW + 7 * DAY_MS);
  });

  // The floor is two "not now"s, never one — at one, the gentle-looking option
  // is the permanent one and "don't ask again" is never offered at all.
  it("runs out after two, so `don't ask again` is reachable", () => {
    expect(snoozePolicyOf(prompt({ snoozeCount: 1 }), NOW)).not.toBeNull();
    expect(snoozePolicyOf(prompt({ snoozeCount: 2 }), NOW)).toBeNull();
  });
});
