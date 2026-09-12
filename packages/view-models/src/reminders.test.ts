import { ONBOARDING_REMINDERS } from "@leapsake/reminders";
import { dueDateMs, todayCivil } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  SNOOZE_PRESET_DAYS,
  bucketReminders,
  partitionReminders,
  reminderActionsOf,
  reminderCountdownOf,
  reminderCtaOf,
} from "./reminders.js";

const reminder = (
  id: string,
  standing: {
    completedAt?: number | null;
    dueDate?: number | null;
    snoozedUntil?: number | null;
    activeFrom?: number | null;
    createdAt?: number;
  },
) => ({
  id,
  completedAt: standing.completedAt ?? null,
  dueDate: standing.dueDate ?? null,
  snoozedUntil: standing.snoozedUntil ?? null,
  activeFrom: standing.activeFrom ?? null,
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

  // A snooze ends on a civil day, so it is compared in whole days: the row is
  // back from the viewer's local midnight, whatever the hour it was put off.
  it("holds a row back until the start of the day its snooze ends, and no longer", () => {
    const noon = Date.parse("2026-06-01T12:00:00");
    const today = dueDateMs(todayCivil(noon));
    const { open, snoozed } = partitionReminders(
      [
        reminder("back-today", { snoozedUntil: today }),
        reminder("back-tomorrow", { snoozedUntil: today + day(1) }),
      ],
      noon,
    );

    expect(open.map((r) => r.id)).toEqual(["back-today"]);
    expect(snoozed.map((r) => r.id)).toEqual(["back-tomorrow"]);
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

/** What a `🗓 plan` prompt is asking about, as core's `reminders.targets` hands it over. */
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
  const TODAY = dueDateMs(todayCivil(NOW));
  const onboarding = ONBOARDING_REMINDERS[0];
  const SNOOZES = SNOOZE_PRESET_DAYS.map((days) => ({ kind: "snooze", days }));
  type Row = Parameters<typeof reminderActionsOf>[0];
  const kinds = (r: Row, context = {}) =>
    reminderActionsOf(r, context, NOW).map((a) => a.kind);
  const snoozeDays = (r: Row) =>
    reminderActionsOf(r, {}, NOW).flatMap((a) =>
      a.kind === "snooze" ? [a.days] : [],
    );

  // Any row, whatever made it, can be put off *(owner, 2026-09-11)*.
  it("offers an ordinary reminder its put-offs and nothing else", () => {
    expect(kinds(reminder("plain", {}))).toEqual([
      "snooze",
      "snooze",
      "snooze",
    ]);
  });

  it("offers one snooze per preset, as a day count", () => {
    expect(snoozeDays(reminder("plain", {}))).toEqual(SNOOZE_PRESET_DAYS);
  });

  it("offers only the presets that land by the due date", () => {
    expect(snoozeDays(reminder("soon", { dueDate: TODAY + day(2) }))).toEqual([
      1,
    ]);
    expect(snoozeDays(reminder("later", { dueDate: TODAY + day(7) }))).toEqual([
      1, 3, 7,
    ]);
  });

  it("offers no snooze on a row due today, or belated", () => {
    expect(snoozeDays(reminder("today", { dueDate: TODAY }))).toEqual([]);
    expect(snoozeDays(reminder("late", { dueDate: TODAY - day(1) }))).toEqual(
      [],
    );
  });

  // Putting off something that is not on Today yet would change nothing.
  it("offers no snooze on a row not on display yet", () => {
    expect(
      snoozeDays(
        reminder("coming", {
          dueDate: TODAY + day(10),
          activeFrom: TODAY + day(3),
        }),
      ),
    ).toEqual([]);
  });

  // *Don't ask again* used to wait for a first "not now"; with nothing retiring
  // by being put off, it is offered from the start *(owner, 2026-09-11)*.
  it("offers a nudge its CTA, the put-offs, and don't ask again from the first encounter", () => {
    expect(kinds(reminder(onboarding.id, {}))).toEqual([
      "cta",
      "snooze",
      "snooze",
      "snooze",
      "dismiss",
    ]);
  });

  it("passes the duplicates CTA through, the put-offs beside it", () => {
    expect(
      reminderActionsOf(
        reminder("nudge", {}),
        { isDuplicatesNudge: true },
        NOW,
      ),
    ).toEqual([{ kind: "cta", cta: { kind: "duplicates" } }, ...SNOOZES]);
  });

  it("passes a gift CTA through, flip and all, the put-offs beside it", () => {
    const giftTarget = { recipientType: "person" as const, recipientId: "p1" };

    expect(
      reminderActionsOf(reminder("gift", {}), { giftTarget }, NOW),
    ).toEqual([
      {
        kind: "cta",
        cta: { kind: "gift", action: "see-gifts", ...giftTarget },
      },
      ...SNOOZES,
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
  it("offers a prompt its CTA, the one-tap answer, the put-offs and don't ask again", () => {
    expect(kinds(reminder("prompt", {}), { planTarget })).toEqual([
      "cta",
      "answer-plan",
      "snooze",
      "snooze",
      "snooze",
      "dismiss",
    ]);
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

  // The collect prompt. A wish for someone with no phone, no email and no handle
  // is a reminder the app cannot help you act on, so it offers to fix that —
  // and only then.
  it("offers to collect a contact method only when there is none", () => {
    const unreachable = { personId: "p1", hasMethods: false };
    const reachable = { personId: "p1", hasMethods: true };

    expect(
      reminderCtaOf(reminder("wish", {}), { contactTarget: unreachable }),
    ).toEqual({ kind: "contact", personId: "p1" });
    // Someone you can already reach is never asked for more: the client renders
    // their methods as buttons, which is not a decision and so not a CTA.
    expect(
      reminderCtaOf(reminder("wish", {}), { contactTarget: reachable }),
    ).toBeNull();
  });

  // ⚠️ *A nudge, never a wall.* The reminder has to stay finishable by someone
  // who never adds a contact method — the whole difference between offering help
  // and demanding setup.
  it("never gates completion on collecting a contact method", () => {
    const kinds = reminderActionsOf(
      reminder("wish", { completedAt: null }),
      { contactTarget: { personId: "p1", hasMethods: false } },
      NOW,
    ).map((a) => a.kind);

    // A link, and the put-offs every row has — nothing that stands between the
    // user and Done, and nothing to answer first.
    expect(kinds).toEqual(["cta", "snooze", "snooze", "snooze"]);
  });

  it("stops offering to put off a reminder that is already done", () => {
    expect(kinds(reminder(onboarding.id, { completedAt: day(4) }))).toEqual([
      "cta",
    ]);
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
    /** What the row's countdown shows, where that is not its due date. */
    countdownIn?: number;
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
  ...(dates.countdownIn === undefined
    ? {}
    : { countdownDate: dayOut(dates.countdownIn) }),
});

describe("bucketReminders", () => {
  it("files every row by where it stands today", () => {
    const result = bucketReminders(
      [
        // Due in 8 days, on display since 22 days ago: a gift project — on Today.
        timed("gift", { dueIn: 8, occurrenceIn: 20, activeIn: -22 }),
        timed("today", { dueIn: 0, occurrenceIn: 0 }),
        // Its post date blew, but the birthday is still four days off.
        timed("missed-post", { dueIn: -3, occurrenceIn: 4, activeIn: -17 }),
        // The birthday itself has gone.
        timed("gone", { dueIn: -1, occurrenceIn: -1 }),
        // A gift errand that goes on display in three days.
        timed("this-week", { dueIn: 17, occurrenceIn: 29, activeIn: 3 }),
        // A wish for a birthday three weeks out — not on display yet.
        timed("later", { dueIn: 21, occurrenceIn: 21 }),
      ],
      NOW,
    );

    expect(result.belated.map((r) => r.id)).toEqual(["missed-post", "gone"]);
    expect(result.today.map((r) => r.id)).toEqual(["today", "gift"]);
    expect(result.next7.map((r) => r.id)).toEqual(["this-week"]);
    expect(result.later.map((r) => r.id)).toEqual(["later"]);
  });

  // The one distinction that cannot be made from `dueDate` alone, and the reason
  // the occurrence has to travel with the row: what can still be saved leads.
  it("puts what can still be saved ahead of what has passed", () => {
    const result = bucketReminders(
      [
        timed("occasion-gone", { dueIn: -3, occurrenceIn: -1 }),
        timed("still-salvageable", { dueIn: -2, occurrenceIn: 5 }),
      ],
      NOW,
    );

    expect(result.belated.map((r) => r.id)).toEqual([
      "still-salvageable",
      "occasion-gone",
    ]);
  });

  // "Call the dentist" a day late has not passed anything: it is exactly as
  // doable as it was yesterday, so it sorts with the salvageable rows.
  it("counts an overdue row with no occasion as salvageable", () => {
    const result = bucketReminders(
      [
        timed("occasion-gone", { dueIn: -9, occurrenceIn: -1 }),
        timed("overdue-user-reminder", { dueIn: -2 }),
      ],
      NOW,
    );

    expect(result.belated.map((r) => r.id)).toEqual([
      "overdue-user-reminder",
      "occasion-gone",
    ]);
  });

  // Decision (owner, 2026-09-04): a nudge is owed, not merely available.
  it("puts dateless rows in today", () => {
    const result = bucketReminders([reminder("nudge", {})], NOW);

    expect(result.today.map((r) => r.id)).toEqual(["nudge"]);
    expect(result.owed).toBe(1);
  });

  // Decision (owner, 2026-09-11): the dateless rows lead today, so a busy
  // morning cannot bury the getting-started steps.
  it("leads today with the dateless rows", () => {
    const result = bucketReminders(
      [
        timed("due-today", { dueIn: 0, occurrenceIn: 0 }),
        reminder("nudge", {}),
      ],
      NOW,
    );

    expect(result.today.map((r) => r.id)).toEqual(["nudge", "due-today"]);
  });

  // The point of folding Available into Today *(owner, 2026-09-11)*: the day is
  // finished only once everything that can be done now has been handled.
  it("counts everything on display as owed, and nothing that isn't", () => {
    const result = bucketReminders(
      [
        timed("owed-now", { dueIn: 0, occurrenceIn: 0 }),
        timed("owed-late", { dueIn: -1, occurrenceIn: 3 }),
        timed("sitting-there", { dueIn: 9, occurrenceIn: 21, activeIn: -21 }),
        timed("not-yet", { dueIn: 25, occurrenceIn: 25 }),
      ],
      NOW,
    );

    expect(result.owed).toBe(3);
  });

  // Putting a row off is how it leaves the day, and "tomorrow" means tomorrow.
  it("files a snoozed row by the day it comes back, and returns it to Today on that day", () => {
    const gift = {
      ...timed("gift", { dueIn: 20, occurrenceIn: 32, activeIn: -10 }),
      snoozedUntil: dayOut(1),
    };

    const now = bucketReminders([gift], NOW);
    expect(now.next7.map((r) => r.id)).toEqual(["gift"]);
    expect(now.owed).toBe(0);

    expect(
      bucketReminders([gift], NOW + day(1)).today.map((r) => r.id),
    ).toEqual(["gift"]);
  });

  it("puts a row arriving in seven days in Next 7 days, and one in eight in Later", () => {
    const result = bucketReminders(
      [
        timed("seven", { dueIn: 30, occurrenceIn: 30, activeIn: 7 }),
        timed("eight", { dueIn: 30, occurrenceIn: 30, activeIn: 8 }),
      ],
      NOW,
    );

    expect(result.next7.map((r) => r.id)).toEqual(["seven"]);
    expect(result.later.map((r) => r.id)).toEqual(["eight"]);
  });

  it("passes completed rows through untouched", () => {
    const result = bucketReminders(
      [timed("done", { dueIn: 0, occurrenceIn: 0, completedAt: NOW })],
      NOW,
    );

    expect(result.done.map((r) => r.id)).toEqual(["done"]);
    expect(result.owed).toBe(0);
  });

  // Each section is ordered by the date that moves a row out of it *(owner,
  // 2026-09-11)* — Today by deadline, a question's included, and the later
  // sections by the day each row enters Today, put off or not yet started.
  it("orders Today by due date, and the later sections by when each row lands", () => {
    const result = bucketReminders(
      [
        // Due in two days, asking about a birthday five days out.
        timed("question", {
          dueIn: 2,
          occurrenceIn: 5,
          countdownIn: 5,
          activeIn: -3,
        }),
        timed("errand", { dueIn: 1, occurrenceIn: 20, activeIn: -10 }),
        {
          ...timed("back-in-five", {
            dueIn: 20,
            occurrenceIn: 30,
            activeIn: -1,
          }),
          snoozedUntil: dayOut(5),
        },
        timed("starts-in-two", { dueIn: 12, occurrenceIn: 12, activeIn: 2 }),
      ],
      NOW,
    );

    expect(result.today.map((r) => r.id)).toEqual(["errand", "question"]);
    expect(result.next7.map((r) => r.id)).toEqual([
      "starts-in-two",
      "back-in-five",
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
    expect(result.belated).toEqual([]);
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

describe("reminderCountdownOf", () => {
  // *Due* keeps a question's deadline from reading as its occasion.
  it("counts Today down to each row's deadline, a question's too", () => {
    const question = timed("question", {
      dueIn: 2,
      occurrenceIn: 30,
      countdownIn: 30,
    });

    expect(reminderCountdownOf(question, "today")).toEqual({
      kind: "due",
      date: dayOut(2),
    });
  });

  it("counts the later sections down to the day a row comes back, or arrives", () => {
    const putOff = {
      ...timed("gift", { dueIn: 20, occurrenceIn: 30, activeIn: -1 }),
      snoozedUntil: dayOut(3),
    };
    const starting = timed("wish", {
      dueIn: 21,
      occurrenceIn: 21,
      activeIn: 10,
    });

    expect(reminderCountdownOf(putOff, "next7")).toEqual({
      kind: "back",
      date: dayOut(3),
    });
    expect(reminderCountdownOf(starting, "later")).toEqual({
      kind: "coming",
      date: dayOut(10),
    });
  });

  it("shows a belated row the date it has always shown", () => {
    const question = timed("question", {
      dueIn: -2,
      occurrenceIn: 5,
      countdownIn: 5,
    });

    expect(reminderCountdownOf(question, "belated")).toEqual({
      kind: "shown",
      date: dayOut(5),
    });
  });

  it("has nothing to count on a dateless row", () => {
    expect(reminderCountdownOf(reminder("nudge", {}), "today")).toBeNull();
  });
});
