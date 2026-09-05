import { ONBOARDING_REMINDERS, snoozePolicyOf } from "@leapsake/reminders";
import { dueDateMs, todayCivil } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  bucketReminders,
  groupComingByActivation,
  partitionReminders,
  reminderActionsOf,
  reminderCtaOf,
} from "./reminders.js";

const reminder = (
  id: string,
  standing: {
    completedAt?: number | null;
    dueDate?: number | null;
    snoozedUntil?: number | null;
    snoozeCount?: number;
    createdAt?: number;
  },
) => ({
  id,
  completedAt: standing.completedAt ?? null,
  dueDate: standing.dueDate ?? null,
  snoozedUntil: standing.snoozedUntil ?? null,
  snoozeCount: standing.snoozeCount ?? 0,
  createdAt: standing.createdAt ?? 0,
});

const day = (n: number) => n * 86_400_000;

describe("partitionReminders", () => {
  it("splits open from completed", () => {
    const { open, done } = partitionReminders([
      reminder("a", {}),
      reminder("b", { completedAt: day(3) }),
    ]);

    expect(open.map((r) => r.id)).toEqual(["a"]);
    expect(done.map((r) => r.id)).toEqual(["b"]);
  });

  it("orders open reminders soonest-due first, undated last", () => {
    const { open } = partitionReminders([
      reminder("undated", {}),
      reminder("later", { dueDate: day(9) }),
      reminder("sooner", { dueDate: day(2) }),
    ]);

    expect(open.map((r) => r.id)).toEqual(["sooner", "later", "undated"]);
  });

  it("keeps completed reminders in the order they arrived", () => {
    const { done } = partitionReminders([
      reminder("newest", { completedAt: day(5), dueDate: day(9) }),
      reminder("older", { completedAt: day(1), dueDate: day(2) }),
    ]);

    expect(done.map((r) => r.id)).toEqual(["newest", "older"]);
  });

  it("does not mutate the caller's array", () => {
    const reminders = [
      reminder("undated", {}),
      reminder("due", { dueDate: day(1) }),
      reminder("hidden", { snoozedUntil: day(9) }),
    ];
    partitionReminders(reminders, day(5));

    expect(reminders.map((r) => r.id)).toEqual(["undated", "due", "hidden"]);
  });

  it("holds a snoozed reminder back until its clock passes", () => {
    const { open, snoozed } = partitionReminders(
      [
        reminder("awake", {}),
        reminder("hidden", { snoozedUntil: day(9) }),
        reminder("never-snoozed", { snoozedUntil: null }),
      ],
      day(5),
    );

    expect(open.map((r) => r.id)).toEqual(["awake", "never-snoozed"]);
    expect(snoozed.map((r) => r.id)).toEqual(["hidden"]);
  });

  it("returns an expired snooze to the open list, in due-date order", () => {
    const { open, snoozed } = partitionReminders(
      [
        reminder("undated", {}),
        reminder("was-snoozed", { snoozedUntil: day(2), dueDate: day(3) }),
        reminder("sooner", { dueDate: day(1) }),
      ],
      day(5),
    );

    // The hide is a filter, never a re-ranking: `was-snoozed` sorts on its due date.
    expect(open.map((r) => r.id)).toEqual(["sooner", "was-snoozed", "undated"]);
    expect(snoozed).toEqual([]);
  });

  it("treats the exact moment the clock arrives as open, not snoozed", () => {
    const { open, snoozed } = partitionReminders(
      [reminder("due-now", { snoozedUntil: day(5) })],
      day(5),
    );

    expect(open.map((r) => r.id)).toEqual(["due-now"]);
    expect(snoozed).toEqual([]);
  });

  it("lets completion win over snooze", () => {
    const { open, done, snoozed } = partitionReminders(
      [reminder("finished", { completedAt: day(4), snoozedUntil: day(9) })],
      day(5),
    );

    expect(done.map((r) => r.id)).toEqual(["finished"]);
    expect(open).toEqual([]);
    expect(snoozed).toEqual([]);
  });
});

/** What a `🗓 plan` prompt is asking about, as core's `planTargets` hands it over. */
const planTarget = {
  milestoneId: "m1",
  milestoneKind: "birthday" as const,
  offers: [
    {
      action: "get:gift" as const,
      label: null,
      offsetDays: 12,
      enabled: false,
    },
    { action: "wish" as const, label: null, offsetDays: 0, enabled: true },
    { action: "call" as const, label: null, offsetDays: 0, enabled: false },
  ],
};

describe("reminderCtaOf", () => {
  const onboarding = ONBOARDING_REMINDERS[0];

  it("offers no CTA on an ordinary reminder", () => {
    expect(reminderCtaOf(reminder("plain", {}))).toBeNull();
  });

  it("routes an onboarding nudge to its step", () => {
    expect(reminderCtaOf(reminder(onboarding.id, {}))).toEqual({
      kind: "onboarding",
      route: onboarding.route,
    });
  });

  it("opens the review from the duplicates nudge", () => {
    expect(
      reminderCtaOf(reminder("nudge", {}), { isDuplicatesNudge: true }),
    ).toEqual({ kind: "duplicates" });
  });

  it("points an open gift reminder at the recipient's gifts", () => {
    expect(
      reminderCtaOf(reminder("gift", {}), {
        giftTarget: { recipientType: "person", recipientId: "p1" },
      }),
    ).toEqual({
      kind: "gift",
      action: "see-gifts",
      recipientType: "person",
      recipientId: "p1",
    });
  });

  it("flips a completed gift reminder to logging what was given", () => {
    expect(
      reminderCtaOf(reminder("gift", { completedAt: day(4) }), {
        giftTarget: { recipientType: "pet", recipientId: "pet1" },
      }),
    ).toEqual({
      kind: "gift",
      action: "record-giving",
      recipientType: "pet",
      recipientId: "pet1",
    });
  });

  it("prefers the onboarding route over any other candidate", () => {
    expect(
      reminderCtaOf(reminder(onboarding.id, {}), {
        isDuplicatesNudge: true,
        giftTarget: { recipientType: "person", recipientId: "p1" },
      }),
    ).toEqual({ kind: "onboarding", route: onboarding.route });
  });
});

describe("reminderCtaOf, for a prompt", () => {
  it("carries the milestone and its offer set", () => {
    expect(reminderCtaOf(reminder("prompt", {}), { planTarget })).toEqual({
      kind: "plan",
      ...planTarget,
    });
  });

  // The CTA discriminates on `kind`, and the milestone has a kind of its own.
  // Spreading one into the other is exactly how that goes wrong silently.
  it("keeps the milestone's kind clear of the CTA's own", () => {
    const cta = reminderCtaOf(reminder("prompt", {}), { planTarget });
    expect(cta?.kind).toBe("plan");
    expect(cta).toMatchObject({ milestoneKind: "birthday" });
  });
});

describe("reminderActionsOf", () => {
  const NOW = day(100);
  const onboarding = ONBOARDING_REMINDERS[0];
  // How many times a step will come back is the engine's dial, so these fixtures
  // ask the policy which nudge is which instead of pinning today's numbers: one
  // with budget left after a single "not now", and a count past anyone's budget.
  const repeatable = ONBOARDING_REMINDERS.filter(
    (r) => snoozePolicyOf({ id: r.id, snoozeCount: 1 }, NOW) !== null,
  )[0];
  const SPENT = 99;
  const kinds = (id: string, snoozeCount = 0) =>
    reminderActionsOf(reminder(id, { snoozeCount }), {}, NOW).map(
      (a) => a.kind,
    );

  it("offers nothing on an ordinary reminder", () => {
    expect(reminderActionsOf(reminder("plain", {}), {}, NOW)).toEqual([]);
  });

  it("offers a fresh nudge its CTA and a snooze, but no dismiss", () => {
    expect(kinds(onboarding.id)).toEqual(["cta", "snooze"]);
  });

  it("adds dismiss once the nudge has been put off before", () => {
    expect(kinds(repeatable.id, 1)).toEqual(["cta", "snooze", "dismiss"]);
  });

  it("keeps dismiss but drops snooze once the repetitions are spent", () => {
    expect(
      snoozePolicyOf({ id: onboarding.id, snoozeCount: SPENT }, NOW),
    ).toBeNull();

    expect(kinds(onboarding.id, SPENT)).toEqual(["cta", "dismiss"]);
  });

  it("carries the policy's own date, rather than deriving it again", () => {
    const policy = snoozePolicyOf({ id: onboarding.id, snoozeCount: 0 }, NOW);

    expect(
      reminderActionsOf(reminder(onboarding.id, {}), {}, NOW),
    ).toContainEqual({ kind: "snooze", until: policy?.until });
  });

  it("passes the duplicates CTA through with nothing alongside it", () => {
    expect(
      reminderActionsOf(
        reminder("nudge", {}),
        { isDuplicatesNudge: true },
        NOW,
      ),
    ).toEqual([{ kind: "cta", cta: { kind: "duplicates" } }]);
  });

  it("passes a gift CTA through, flip and all, with nothing alongside it", () => {
    const giftTarget = { recipientType: "person" as const, recipientId: "p1" };

    expect(
      reminderActionsOf(
        reminder("gift", { snoozeCount: 2 }),
        { giftTarget },
        NOW,
      ),
    ).toEqual([
      {
        kind: "cta",
        cta: { kind: "gift", action: "see-gifts", ...giftTarget },
      },
    ]);
    expect(
      reminderActionsOf(
        reminder("gift", { completedAt: day(4) }),
        { giftTarget },
        NOW,
      ),
    ).toEqual([
      {
        kind: "cta",
        cta: { kind: "gift", action: "record-giving", ...giftTarget },
      },
    ]);
  });

  // ⚠️ The trade this prompt makes only pays off if the common answer is cheaper
  // than ignoring a row was, so "just the day" is offered beside the CTA rather
  // than living behind it.
  it("offers a prompt its CTA, the one-tap answer, and a snooze", () => {
    expect(
      reminderActionsOf(reminder("prompt", {}), { planTarget }, NOW).map(
        (a) => a.kind,
      ),
    ).toEqual(["cta", "answer-plan", "snooze"]);
  });

  // It writes the **full** offer set with only `wish` on — not just the tick.
  // Rows existing is the "answered" marker, so a partial write would leave the
  // occasion looking unasked and the question would return next year.
  it("answers `just the day` with the whole offer set, wish alone enabled", () => {
    const answer = reminderActionsOf(
      reminder("prompt", {}),
      { planTarget },
      NOW,
    ).find((a) => a.kind === "answer-plan");

    expect(answer).toEqual({
      kind: "answer-plan",
      milestoneId: "m1",
      schedule: [
        { action: "get:gift", label: null, offsetDays: 12, enabled: false },
        { action: "wish", label: null, offsetDays: 0, enabled: true },
        { action: "call", label: null, offsetDays: 0, enabled: false },
      ],
    });
  });

  // A question the user does not want to answer needs a permanent out, on the
  // same terms a nudge gets one: withheld on the first encounter so it is never
  // a trap, offered from the second.
  it("withholds `don't ask again` from a prompt until it has been put off once", () => {
    const kindsOf = (snoozeCount: number) =>
      reminderActionsOf(
        reminder("prompt", { snoozeCount }),
        { planTarget },
        NOW,
      ).map((a) => a.kind);

    expect(kindsOf(0)).not.toContain("dismiss");
    expect(kindsOf(1)).toContain("dismiss");
  });

  it("stops offering to put off a reminder that is already done", () => {
    expect(
      reminderActionsOf(
        reminder(repeatable.id, { completedAt: day(4), snoozeCount: 1 }),
        {},
        NOW,
      ).map((a) => a.kind),
    ).toEqual(["cta"]);
  });
});

// A fixed local noon, so "today" is the same civil day whatever the machine's
// timezone; every date below is derived from it through the same stored-due-date
// round-trip the engine uses, so the buckets are timezone-immune.
const NOW = Date.parse("2026-06-01T12:00:00");
const dayOut = (n: number) => dueDateMs(todayCivil(NOW)) + day(n);

/** A dated row as `listInWindow` hands it over: due `dueIn` days out, counting
 *  down to an occasion `occurrenceIn` days out, on display from `activeIn`. */
const timed = (
  id: string,
  dates: {
    dueIn: number;
    occurrenceIn?: number;
    activeIn?: number;
    completedAt?: number | null;
  },
) => ({
  ...reminder(id, {
    dueDate: dayOut(dates.dueIn),
    completedAt: dates.completedAt ?? null,
  }),
  activeFrom: dayOut(dates.activeIn ?? dates.dueIn),
  occurrenceDate:
    dates.occurrenceIn === undefined ? null : dayOut(dates.occurrenceIn),
});

describe("bucketReminders", () => {
  it("splits the open list by due date", () => {
    const result = bucketReminders(
      [
        // Due in 8 days, on display since 22 days ago: a gift project.
        timed("gift", { dueIn: 8, occurrenceIn: 20, activeIn: -22 }),
        timed("today", { dueIn: 0, occurrenceIn: 0 }),
        // Its post date blew, but the birthday is still four days off.
        timed("past-due", { dueIn: -3, occurrenceIn: 4, activeIn: -17 }),
        // The birthday itself has gone.
        timed("belated", { dueIn: -1, occurrenceIn: -1 }),
        // A wish for a birthday three weeks out — not on display yet.
        timed("coming", { dueIn: 21, occurrenceIn: 21 }),
      ],
      NOW,
    );

    expect(result.pastDue.map((r) => r.id)).toEqual(["past-due"]);
    expect(result.belated.map((r) => r.id)).toEqual(["belated"]);
    expect(result.today.map((r) => r.id)).toEqual(["today"]);
    expect(result.available.map((r) => r.id)).toEqual(["gift"]);
    expect(result.coming.map((r) => r.id)).toEqual(["coming"]);
  });

  // The one distinction that cannot be made from `dueDate` alone, and the reason
  // the occurrence has to travel with the row.
  it("tells past due from belated only by the occurrence", () => {
    const result = bucketReminders(
      [
        timed("still-salvageable", { dueIn: -2, occurrenceIn: 5 }),
        timed("occasion-gone", { dueIn: -2, occurrenceIn: -1 }),
      ],
      NOW,
    );

    expect(result.pastDue.map((r) => r.id)).toEqual(["still-salvageable"]);
    expect(result.belated.map((r) => r.id)).toEqual(["occasion-gone"]);
  });

  // "Call the dentist" a day late is not belated: nothing has passed, and it is
  // exactly as doable as it was yesterday.
  it("never calls a row with no occasion belated", () => {
    const result = bucketReminders(
      [timed("overdue-user-reminder", { dueIn: -9 })],
      NOW,
    );

    expect(result.pastDue.map((r) => r.id)).toEqual(["overdue-user-reminder"]);
    expect(result.belated).toEqual([]);
  });

  // Decision (owner, 2026-09-04): a nudge is owed, not merely available.
  it("puts dateless rows in today", () => {
    const result = bucketReminders([reminder("nudge", {})], NOW);

    expect(result.today.map((r) => r.id)).toEqual(["nudge"]);
    expect(result.owed).toBe(1);
  });

  // The whole point of the split: a month-long errand must not make the day
  // unfinishable.
  it("counts owed without available, and actionable with it", () => {
    const result = bucketReminders(
      [
        timed("owed-now", { dueIn: 0, occurrenceIn: 0 }),
        timed("owed-late", { dueIn: -1, occurrenceIn: 3 }),
        timed("sitting-there", { dueIn: 9, occurrenceIn: 21, activeIn: -21 }),
        timed("not-yet", { dueIn: 25, occurrenceIn: 25 }),
      ],
      NOW,
    );

    expect(result.owed).toBe(2);
    expect(result.actionable).toBe(3);
  });

  it("passes completed and snoozed rows through untouched", () => {
    const snoozedRow = {
      ...reminder("snoozed", {
        dueDate: dayOut(0),
        snoozedUntil: NOW + day(2),
      }),
      activeFrom: dayOut(0),
      occurrenceDate: dayOut(0),
    };
    const result = bucketReminders(
      [
        timed("done", { dueIn: 0, occurrenceIn: 0, completedAt: NOW }),
        snoozedRow,
      ],
      NOW,
    );

    expect(result.done.map((r) => r.id)).toEqual(["done"]);
    expect(result.snoozed.map((r) => r.id)).toEqual(["snoozed"]);
    expect(result.owed).toBe(0);
  });

  it("orders each bucket soonest first, and coming by when it lands", () => {
    const result = bucketReminders(
      [
        timed("later", { dueIn: 9, occurrenceIn: 21, activeIn: -21 }),
        timed("sooner", { dueIn: 2, occurrenceIn: 14, activeIn: -12 }),
        timed("lands-second", { dueIn: 28, occurrenceIn: 28 }),
        timed("lands-first", { dueIn: 26, occurrenceIn: 26, activeIn: 12 }),
      ],
      NOW,
    );

    expect(result.available.map((r) => r.id)).toEqual(["sooner", "later"]);
    expect(result.coming.map((r) => r.id)).toEqual([
      "lands-first",
      "lands-second",
    ]);
  });

  // Whole civil days, not elapsed milliseconds: a row due today is due today all
  // day, and becomes past due at local midnight rather than 24h after minting.
  it("holds a row in today for the whole of its day", () => {
    const almostMidnight = Date.parse("2026-06-01T23:59:00");
    const result = bucketReminders(
      [timed("today", { dueIn: 0, occurrenceIn: 0 })],
      almostMidnight,
    );

    expect(result.today.map((r) => r.id)).toEqual(["today"]);
    expect(result.pastDue).toEqual([]);
  });

  it("does not mutate its input", () => {
    const rows = [
      timed("b", { dueIn: 4, occurrenceIn: 4 }),
      timed("a", { dueIn: 1, occurrenceIn: 1 }),
    ];
    bucketReminders(rows, NOW);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("groupComingByActivation", () => {
  it("groups by the day each row lands, ascending", () => {
    const { coming } = bucketReminders(
      [
        timed("later", { dueIn: 25, occurrenceIn: 25, activeIn: 20 }),
        timed("sooner-a", { dueIn: 14, occurrenceIn: 14, activeIn: 6 }),
        timed("sooner-b", { dueIn: 30, occurrenceIn: 30, activeIn: 6 }),
      ],
      NOW,
    );

    expect(
      groupComingByActivation(coming).map((g) => [
        g.activeFrom,
        g.reminders.map((r) => r.id),
      ]),
    ).toEqual([
      [dayOut(6), ["sooner-a", "sooner-b"]],
      [dayOut(20), ["later"]],
    ]);
  });

  it("has nothing to group when nothing is coming", () => {
    expect(groupComingByActivation([])).toEqual([]);
  });
});
