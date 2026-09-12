import { deterministicUuid } from "@leapsake/bytes";
import {
  type CivilDate,
  type MilestoneKind,
  type RemindEligibleMilestone,
  type Reminder,
  type ReminderRuleInput,
  OFFER_NOTICE_DAYS,
  actionDefs,
  civilFromDueMs,
  dueDateMs,
  kindDefs,
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

/** A late gift or card is handed over in person — the day before. */
const IN_PERSON = actionDefs["get:gift"].latestOffsetDays; // 1
/** The last day, in days before a birthday, posting is still offered. */
const LAST_TO_POST =
  kindDefs.birthday.defaultReminderSchedule.find(
    (d) => d.action === "send:card",
  )!.offsetDays + OFFER_NOTICE_DAYS; // 9
/** The last day, in days before a birthday, shopping is still offered. */
const LAST_TO_SHOP = IN_PERSON + OFFER_NOTICE_DAYS; // 3

/** Local noon on a civil day — what a row written that day carries as `createdAt`. */
function at(day: CivilDate): number {
  return new Date(day.year, day.month - 1, day.day, 12).getTime();
}

/** As {@link makeHarness} in `engine.test.ts`, narrowed to what a prompt needs. */
function makeHarness() {
  const rows = new Map<string, Reminder>();
  let milestones: RemindEligibleMilestone[] = [];
  let today = TODAY;
  let selfPersonId: string | null = null;
  const labels = new Map<string, string>([["p1", "Violet"]]);
  const schedules = new Map<string, ReminderRuleInput[]>();
  const writtenAts = new Map<string, number>();

  const deps: ReminderEngineDeps = {
    milestones: { listRemindEligible: async () => milestones },
    // A set schedule stands in for stored rule rows, so it reads as `stored` and
    // must suppress the prompt exactly as real rows do.
    resolveSchedule: async (m) => {
      const custom = schedules.get(m.id);
      return custom === undefined
        ? resolveReminderSchedule(m.kind, [])
        : {
            rules: custom,
            source: "stored" as const,
            writtenAt: writtenAts.get(m.id) ?? null,
          };
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
    /** Stand in for stored rules, saved at `writtenAt` (default: long ago). */
    setSchedule: (
      milestoneId: string,
      rules: ReminderRuleInput[],
      writtenAt?: number,
    ) => {
      schedules.set(milestoneId, rules);
      if (writtenAt !== undefined) writtenAts.set(milestoneId, writtenAt);
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
    createdAt: 0,
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
      `🗓 What do you want to do for ${mentionToken("Violet", "person", "p1")}'s birthday?`,
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
        subject: "Violet",
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
  // defaults, so you never lose the birthday. By the day itself the question
  // has retired — only the wish is left to choose — and the wish stands.
  it("leaves the day-of wish standing when it is ignored", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS))]);
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()).toHaveLength(1);

    h.setToday(daysOut(APPEARS_DAYS));
    await regenerateSystemReminders(h.deps);
    const titles = h.activeSystem().map((r) => r.title);
    expect(titles).toContain(
      `🎉 Wish ${mentionToken("Violet", "person", "p1")} a happy birthday`,
    );
    expect(h.prompts()).toHaveLength(0);
  });

  // Ignoring a question is worth being nudged about, so it survives its own
  // deadline — overdue, and still answerable, the chosen actions simply
  // materialising with compressed windows. It retires once it has nothing left
  // to offer but the wish, rather than lingering to the occasion.
  it("survives its own deadline, and retires once only the wish is left", async () => {
    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS))]);
    await regenerateSystemReminders(h.deps);
    const id = h.prompts()[0].id;

    // A fortnight after it came due, with the birthday still a month away.
    h.setToday(daysOut(ACTIVE_DAYS + 14));
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()[0].id).toBe(id); // same row, past due

    // The last day a gift can still be offered: still asked.
    h.setToday(daysOut(APPEARS_DAYS - LAST_TO_SHOP));
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()).toHaveLength(1);

    // The day after, only the wish is left: gone.
    h.setToday(daysOut(APPEARS_DAYS - LAST_TO_SHOP + 1));
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()).toHaveLength(0);
  });

  // A question's due date is when to decide by, six weeks early; a row reading
  // "in 2 weeks" was taken for the birthday. It counts down to the occasion.
  it("counts down to the occasion, not to when to decide by", async () => {
    const occ = daysOut(APPEARS_DAYS);
    h.setMilestones([birthday("m1", "p1", occ)]);
    await regenerateSystemReminders(h.deps);

    const rows = await listRemindersInWindow(h.deps, DISPLAY_WINDOW_DAYS);
    const prompt = rows.find((r) => r.id === h.prompts()[0].id)!;
    expect(prompt.countdownDate).toBe(dueDateMs(occ));
    expect(prompt.dueDate).not.toBe(dueDateMs(occ));
  });

  // Same branch, same reason as the birthday wish: keyed on a fact about the
  // bearer, never on identity — the row is still `...:plan`.
  it("addresses your own occasion to you", async () => {
    h.setSelf("p1");
    h.setMilestones([birthday("m1", "p1", daysOut(APPEARS_DAYS))]);
    await regenerateSystemReminders(h.deps);

    expect(h.prompts()[0].title).toBe(
      "🗓 What do you want to do for your own birthday?",
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

/** The milestone as the app would hold it had it learned of it today. */
const learnedToday = (m: RemindEligibleMilestone): RemindEligibleMilestone => ({
  ...m,
  createdAt: at(TODAY),
});

// **You can't be late for something the app has only just learned** *(owner,
// 2026-09-11)*. The import case: forty people arrive at once, and every
// occasion inside its own lead time used to arrive already overdue.
describe("an occasion the app learns about late", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  // Three weeks out, the usual question would have been due three weeks ago.
  // It is due instead when the user would start losing an option — the last
  // day to post.
  it("asks without being overdue, due on the last day to post", async () => {
    const occ = daysOut(20);
    h.setMilestones([learnedToday(birthday("m1", "p1", occ))]);
    await regenerateSystemReminders(h.deps);

    const [prompt] = h.prompts();
    expect(prompt.dueDate).toBe(dueDateMs(occ) - LAST_TO_POST * DAY_MS);
    expect(prompt.dueDate!).toBeGreaterThan(dueDateMs(TODAY));
  });

  it("is due on the last day to shop, when posting is already out", async () => {
    const occ = daysOut(5);
    h.setMilestones([learnedToday(birthday("m1", "p1", occ))]);
    await regenerateSystemReminders(h.deps);

    expect(h.prompts()[0].dueDate).toBe(dueDateMs(occ) - LAST_TO_SHOP * DAY_MS);
  });

  it("is on display from the day it arrives", async () => {
    h.setMilestones([learnedToday(birthday("m1", "p1", daysOut(20)))]);
    await regenerateSystemReminders(h.deps);

    const rows = await listRemindersInWindow(h.deps, DISPLAY_WINDOW_DAYS);
    const prompt = rows.find((r) => r.id === h.prompts()[0].id)!;
    expect(prompt.activeFrom!).toBeLessThanOrEqual(dueDateMs(TODAY));
  });

  // Overdue is still honest once ignoring it has cost something.
  it("becomes overdue once it has cost an option", async () => {
    h.setMilestones([learnedToday(birthday("m1", "p1", daysOut(20)))]);
    await regenerateSystemReminders(h.deps);
    const id = h.prompts()[0].id;

    const later = daysOut(20 - LAST_TO_POST + 1);
    h.setToday(later);
    await regenerateSystemReminders(h.deps);
    const [prompt] = h.prompts();
    expect(prompt.id).toBe(id);
    expect(prompt.dueDate!).toBeLessThan(dueDateMs(later));
  });

  it("is not asked when only the wish is left", async () => {
    h.setMilestones([learnedToday(birthday("m1", "p1", daysOut(1)))]);
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()).toHaveLength(0);
  });

  // A birthday the day before the import was never the user's to act on.
  it("does not remind an occasion that had already been", async () => {
    const occ = daysOut(-1);
    // Known of all along, it is a belated wish…
    h.setMilestones([birthday("m1", "p1", occ)]);
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(1);

    // …but learned of today, it is nothing at all.
    const fresh = makeHarness();
    fresh.setMilestones([learnedToday(birthday("m1", "p1", occ))]);
    await regenerateSystemReminders(fresh.deps);
    expect(fresh.activeSystem()).toHaveLength(0);
  });
});

describe("an answer given late", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  const giftAndWish: ReminderRuleInput[] = [
    { action: "get:gift", offsetDays: 12, enabled: true },
    { action: "wish", offsetDays: 0, enabled: true },
  ];
  const giftOf = () =>
    h.activeSystem().find((r) => r.title?.includes("a gift") === true)!;

  // Chosen five days out, a gift cannot make its twelve-day deadline. It slides
  // to the day before, to be handed over in person — you can't be late for
  // something you only just chose.
  it("slides a last-minute gift to the day before", async () => {
    const occ = daysOut(5);
    h.setMilestones([birthday("m1", "p1", occ)]);
    h.setSchedule("m1", giftAndWish, at(TODAY));
    await regenerateSystemReminders(h.deps);

    expect(giftOf().dueDate).toBe(dueDateMs(occ) - IN_PERSON! * DAY_MS);
  });

  it("keeps the deadline of a gift chosen in time", async () => {
    const occ = daysOut(20);
    h.setMilestones([birthday("m1", "p1", occ)]);
    h.setSchedule("m1", giftAndWish, at(TODAY));
    await regenerateSystemReminders(h.deps);

    expect(giftOf().dueDate).toBe(dueDateMs(occ) - 12 * DAY_MS);
  });

  // Offered only what still fitted, a late answer covers its own year; the
  // question comes back for the next, eight weeks ahead, with everything on
  // offer.
  it("asks again the next year when it could not offer everything", async () => {
    const occ = daysOut(5);
    h.setMilestones([birthday("m1", "p1", occ)]);
    h.setSchedule("m1", giftAndWish, at(TODAY));
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()).toHaveLength(0);

    const next: CivilDate = { ...occ, year: occ.year + 1 };
    h.setToday(civilFromDueMs(dueDateMs(next) - APPEARS_DAYS * DAY_MS));
    await regenerateSystemReminders(h.deps);
    expect(h.prompts().map((p) => p.id)).toEqual([
      deterministicUuid(
        SYSTEM_REMINDER_NAMESPACE,
        `milestone:m1:${next.year}:plan`,
      ),
    ]);
  });

  it("does not ask again after an answer given in time", async () => {
    const occ = daysOut(APPEARS_DAYS);
    h.setMilestones([birthday("m1", "p1", occ)]);
    h.setSchedule("m1", giftAndWish, at(TODAY));

    const next: CivilDate = { ...occ, year: occ.year + 1 };
    h.setToday(civilFromDueMs(dueDateMs(next) - APPEARS_DAYS * DAY_MS));
    await regenerateSystemReminders(h.deps);
    expect(h.prompts()).toHaveLength(0);
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
