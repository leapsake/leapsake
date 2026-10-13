import { type CivilDate, dueDateMs } from "@leapsake/schema";
import { BELATED_DAYS, NOTIFICATION_WINDOW_DAYS } from "@leapsake/reminders";
import { describe, expect, it } from "vitest";
import {
  type DesiredNotification,
  type DigestSituation,
  NOTIFICATION_BUDGET,
  type NotifiableReminder,
  type NotificationCopy,
  type NotificationPolicy,
  type PlanOptions,
  planNotifications as planWith,
} from "../src/index.js";

/** Wording that spells out the situation it was written from, so a test reads
 *  what the planner decided rather than any phrasing. */
const COPY: NotificationCopy = {
  digest: (situation) => ({
    title: JSON.stringify({ ...situation, labels: undefined }),
    body: situation.labels.join(" | "),
  }),
  runningOut: { title: "running out", body: "open the app" },
};

const situationOf = (n: DesiredNotification) =>
  JSON.parse(n.title) as Omit<DigestSituation, "labels">;

const planNotifications = (
  reminders: readonly NotifiableReminder[],
  policy: NotificationPolicy,
  now: number,
  options?: PlanOptions,
) => planWith(reminders, policy, COPY, now, options);

/** Local wall-clock instant — the same construction {@link planNotifications}
 *  uses for `fireAt`, so expectations stay timezone-agnostic across machines. */
function localInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function due(day: CivilDate): number {
  return dueDateMs(day);
}

/** A user reminder as the engine hands it over: on display from its due date,
 *  or at once when undated, with no occasion to end on. */
function reminder(
  overrides: Partial<NotifiableReminder> & { id: string },
): NotifiableReminder {
  return {
    title: "Reminder",
    body: null,
    dueDate: null,
    activeFrom: overrides.dueDate ?? null,
    occurrenceDate: null,
    category: "custom",
    completedAt: null,
    snoozedUntil: null,
    deletedAt: null,
    ...overrides,
  };
}

/** A system reminder due on its occasion's day, which it outlives by
 *  `BELATED_DAYS`. */
function occasion(
  id: string,
  dueMs: number,
  overrides: Partial<NotifiableReminder> = {},
): NotifiableReminder {
  return reminder({
    id,
    dueDate: dueMs,
    activeFrom: dueMs,
    occurrenceDate: dueMs,
    category: "occasion",
    ...overrides,
  });
}

/** The plan's digest ids, the service notice left out. */
const idsOf = (plan: DesiredNotification[]) =>
  plan.filter((n) => n.id !== "tripwire").map((n) => n.id);

/** What a device notifies about unless it opts into Leapsake's to-dos. */
const MINE = ["custom", "occasion"] as const;

const POLICY_DIGEST = {
  mode: "digest" as const,
  deliveryMinutes: [540], // 09:00
  categories: MINE,
};
const NOW = localInstant(2026, 8, 15, 8, 0);

/** The service notice is the one planned entry not about a reminder; these two
 *  keep every other assertion about reminders alone. */
const isTripwire = (n: DesiredNotification) => n.id === "tripwire";
const realOnly = (plan: DesiredNotification[]) =>
  plan.filter((n) => !isTripwire(n));
const tripwireOf = (plan: DesiredNotification[]) =>
  plan.find((n) => isTripwire(n)) ?? null;

const DAY = 86_400_000;

describe("planNotifications", () => {
  it("off mode plans nothing", () => {
    const r = reminder({
      id: "r1",
      dueDate: due({ year: 2026, month: 8, day: 20 }),
    });
    expect(
      planNotifications(
        [r],
        { ...POLICY_DIGEST, mode: "off", deliveryMinutes: [540] },
        NOW,
      ),
    ).toEqual([]);
  });

  it("digest bundles same-day reminders into one entry and sorts by day", () => {
    const reminders = [
      occasion("r1", due({ year: 2026, month: 8, day: 20 }), {
        title: "Wish Violet a happy birthday",
      }),
      occasion("r2", due({ year: 2026, month: 8, day: 16 }), {
        title: "Call Harry",
      }),
      occasion("r3", due({ year: 2026, month: 8, day: 16 }), {
        title: "Gift Tilly",
      }),
    ];

    const result = planNotifications(reminders, POLICY_DIGEST, NOW);

    expect(idsOf(result)).toEqual([
      "digest:2026-08-16@0900",
      "digest:2026-08-17@0900",
      "digest:2026-08-18@0900",
      "digest:2026-08-20@0900",
      "digest:2026-08-21@0900",
      "digest:2026-08-22@0900",
    ]);
    expect(result[0]).toMatchObject({
      fireAt: localInstant(2026, 8, 16, 9, 0),
      body: "Call Harry | Gift Tilly",
      // Two reminders that day — no single tap target.
      reminderId: null,
    });
    expect(result[3]).toMatchObject({
      fireAt: localInstant(2026, 8, 20, 9, 0),
      // Exactly one reminder that day — taps straight through to it.
      reminderId: "r1",
    });
  });

  it("stays silent for completed and deleted rows", () => {
    const dueDay = due({ year: 2026, month: 8, day: 20 });
    const reminders: NotifiableReminder[] = [
      occasion("keep", dueDay),
      occasion("done", dueDay, { completedAt: NOW }),
      occasion("gone", dueDay, { deletedAt: NOW }),
    ];

    const result = planNotifications(reminders, POLICY_DIGEST, NOW);

    expect(new Set(result.map((n) => n.reminderId))).toEqual(new Set(["keep"]));
  });
});

describe("planNotifications — categories", () => {
  const dueDay = due({ year: 2026, month: 8, day: 20 });
  const reminders = [
    reminder({ id: "written", title: "written", dueDate: dueDay }),
    occasion("birthday", dueDay, { title: "birthday" }),
    reminder({ id: "set-up", title: "set-up", category: "todo" }),
  ];
  const notifiedIn = (categories: NotificationPolicy["categories"]) =>
    new Set(
      planNotifications(reminders, { ...POLICY_DIGEST, categories }, NOW).map(
        (n) => n.body,
      ),
    );

  it("leaves Leapsake's to-dos out unless the device opts in", () => {
    const bodies = planNotifications(reminders, POLICY_DIGEST, NOW).map(
      (n) => n.body,
    );

    expect(bodies.some((body) => body.includes("set-up"))).toBe(false);
    expect(bodies[0]).toBe("written | birthday");
  });

  it("notifies a to-do every day until it is done, once opted in", () => {
    const ids = planNotifications(
      [reminder({ id: "set-up", category: "todo" })],
      { ...POLICY_DIGEST, categories: ["todo"] },
      NOW,
    ).map((n) => n.id);

    expect(ids.slice(0, 2)).toEqual([
      "digest:2026-08-15@0900",
      "digest:2026-08-16@0900",
    ]);
  });

  it("plans nothing when every category is off", () => {
    expect(notifiedIn([])).toEqual(new Set());
  });
});

describe("planNotifications — which days notify", () => {
  it("notifies every day from the one a row goes on display", () => {
    const r = occasion("gift", due({ year: 2026, month: 8, day: 20 }), {
      activeFrom: due({ year: 2026, month: 8, day: 17 }),
    });

    expect(idsOf(planNotifications([r], POLICY_DIGEST, NOW))).toEqual([
      "digest:2026-08-17@0900",
      "digest:2026-08-18@0900",
      "digest:2026-08-19@0900",
      "digest:2026-08-20@0900",
      "digest:2026-08-21@0900",
      "digest:2026-08-22@0900",
    ]);
  });

  it("notifies a row already on display from today", () => {
    const r = occasion("gift", due({ year: 2026, month: 8, day: 16 }), {
      activeFrom: due({ year: 2026, month: 8, day: 10 }),
    });

    expect(idsOf(planNotifications([r], POLICY_DIGEST, NOW))).toEqual([
      "digest:2026-08-15@0900",
      "digest:2026-08-16@0900",
      "digest:2026-08-17@0900",
      "digest:2026-08-18@0900",
    ]);
  });

  it(`stops ${BELATED_DAYS} days after the occasion, when the row is pruned`, () => {
    const r = occasion("wish", due({ year: 2026, month: 8, day: 20 }));

    const ids = idsOf(planNotifications([r], POLICY_DIGEST, NOW));

    expect(ids.at(-1)).toBe("digest:2026-08-22@0900");
  });

  it("keeps notifying a row with no occasion until it is done", () => {
    const r = reminder({
      id: "call",
      dueDate: due({ year: 2026, month: 8, day: 17 }),
    });

    const ids = idsOf(
      planNotifications([r], POLICY_DIGEST, NOW, {
        budget: Number.POSITIVE_INFINITY,
      }),
    );

    expect(ids.slice(0, 3)).toEqual([
      "digest:2026-08-17@0900",
      "digest:2026-08-18@0900",
      "digest:2026-08-19@0900",
    ]);
    // Daily through the year the plan looks ahead, from 17 August on.
    expect(ids).toHaveLength(NOTIFICATION_WINDOW_DAYS - 1);
  });

  it("notifies an undated row from today", () => {
    const r = reminder({ id: "question" });

    const ids = idsOf(planNotifications([r], POLICY_DIGEST, NOW));

    expect(ids.slice(0, 2)).toEqual([
      "digest:2026-08-15@0900",
      "digest:2026-08-16@0900",
    ]);
  });

  // The regression an earlier version had: a snoozed row was dropped outright,
  // which silently cancelled its due-day notification.
  it("is silent while snoozed, then notifies every day from its return", () => {
    const r = occasion("gift", due({ year: 2026, month: 8, day: 20 }), {
      activeFrom: due({ year: 2026, month: 8, day: 10 }),
      snoozedUntil: due({ year: 2026, month: 8, day: 18 }),
    });

    expect(idsOf(planNotifications([r], POLICY_DIGEST, NOW))).toEqual([
      "digest:2026-08-18@0900",
      "digest:2026-08-19@0900",
      "digest:2026-08-20@0900",
      "digest:2026-08-21@0900",
      "digest:2026-08-22@0900",
    ]);
  });

  it("notifies an undated row from the day its snooze ends", () => {
    const r = reminder({
      id: "question",
      snoozedUntil: due({ year: 2026, month: 8, day: 18 }),
    });

    const ids = idsOf(planNotifications([r], POLICY_DIGEST, NOW));

    expect(ids[0]).toBe("digest:2026-08-18@0900");
  });

  it("ignores a snooze that has already ended", () => {
    const r = occasion("r1", due({ year: 2026, month: 8, day: 16 }), {
      activeFrom: due({ year: 2026, month: 8, day: 10 }),
      snoozedUntil: due({ year: 2026, month: 8, day: 12 }),
    });

    expect(idsOf(planNotifications([r], POLICY_DIGEST, NOW))[0]).toBe(
      "digest:2026-08-15@0900",
    );
  });

  it("digest bundles one row's return with another's first day, counting each once", () => {
    const day = due({ year: 2026, month: 8, day: 18 });
    const reminders = [
      occasion("back", due({ year: 2026, month: 8, day: 25 }), {
        activeFrom: due({ year: 2026, month: 8, day: 10 }),
        snoozedUntil: day,
      }),
      occasion("due", day),
    ];

    const result = planNotifications(reminders, POLICY_DIGEST, NOW);

    expect(result[0].id).toBe("digest:2026-08-18@0900");
    expect(result[0].body).toBe("Reminder | Reminder");
  });
});

describe("planNotifications — several delivery times", () => {
  const MORNING_AND_EVENING = {
    ...POLICY_DIGEST,
    deliveryMinutes: [540, 1140], // 09:00 and 19:00
  };

  it("plans a digest at each time on every day", () => {
    const r = occasion("wish", due({ year: 2026, month: 8, day: 20 }));

    const ids = idsOf(planNotifications([r], MORNING_AND_EVENING, NOW));

    expect(ids.slice(0, 4)).toEqual([
      "digest:2026-08-20@0900",
      "digest:2026-08-20@1900",
      "digest:2026-08-21@0900",
      "digest:2026-08-21@1900",
    ]);
  });

  it("carries the same reminders at each of a day's times", () => {
    const r = occasion("wish", due({ year: 2026, month: 8, day: 20 }));

    const [morning, evening] = planNotifications([r], MORNING_AND_EVENING, NOW);

    expect(evening).toMatchObject({
      fireAt: localInstant(2026, 8, 20, 19, 0),
      body: morning.body,
      reminderId: "wish",
    });
  });

  it("marks every time after the day's first as a follow-up", () => {
    const r = occasion("wish", due({ year: 2026, month: 8, day: 20 }));

    const [morning, evening] = planNotifications(
      [r],
      { ...POLICY_DIGEST, mode: "digest", deliveryMinutes: [540, 1140] },
      NOW,
    );

    expect(situationOf(morning).followUp).toBe(false);
    expect(situationOf(evening).followUp).toBe(true);
  });

  it.each([
    [240, "morning"],
    [9 * 60 + 59, "morning"],
    [10 * 60, "day"],
    [16 * 60 + 59, "day"],
    [17 * 60, "evening"],
    [3 * 60 + 59, "evening"],
  ])("words minute %i as %s", (minute, partOfDay) => {
    const r = occasion("wish", due({ year: 2026, month: 8, day: 20 }));

    const [first] = planNotifications(
      [r],
      { ...POLICY_DIGEST, mode: "digest", deliveryMinutes: [minute] },
      NOW,
    );

    expect(situationOf(first).partOfDay).toBe(partOfDay);
  });

  // Reconcile reschedules on any change of text, so the phrasing a digest is
  // given must not move between plans.
  it("gives each digest the same variant on every plan", () => {
    const r = reminder({ id: "question" });

    const a = planNotifications([r], MORNING_AND_EVENING, NOW);
    const b = planNotifications([r], MORNING_AND_EVENING, NOW + 60_000);

    expect(a.map((n) => situationOf(n).variant)).toEqual(
      b.map((n) => situationOf(n).variant),
    );
    expect(new Set(a.map((n) => situationOf(n).variant)).size).toBeGreaterThan(
      1,
    );
  });

  it("keeps today's later time once its earlier one has passed", () => {
    const r = reminder({ id: "question" });
    const afterNine = localInstant(2026, 8, 15, 10, 0);

    const ids = idsOf(planNotifications([r], MORNING_AND_EVENING, afterNine));

    expect(ids.slice(0, 2)).toEqual([
      "digest:2026-08-15@1900",
      "digest:2026-08-16@0900",
    ]);
  });

  it("spends one slot of the budget per time", () => {
    const r = reminder({ id: "question" });

    const plan = planNotifications([r], MORNING_AND_EVENING, NOW);

    // Thirty days of coverage: too short to warrant the running-out notice.
    expect(plan).toHaveLength(NOTIFICATION_BUDGET);
    expect(plan.at(-1)?.fireAt).toBe(localInstant(2026, 8, 15 + 29, 19, 0));
  });
});

describe("planNotifications — the budget", () => {
  /** One occasion a day from 1 September, so every day has a digest. */
  const dailyOccasions = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      occasion(`r${i}`, due({ year: 2026, month: 9, day: 1 }) + i * DAY),
    );

  it("caps to the soonest NOTIFICATION_BUDGET, notice included", () => {
    const result = planNotifications(
      dailyOccasions(NOTIFICATION_BUDGET + 5),
      POLICY_DIGEST,
      NOW,
    );

    // The budget is the whole plan, the service notice included — overshooting
    // it by one would be the silent iOS drop the budget exists to prevent.
    expect(result).toHaveLength(NOTIFICATION_BUDGET);
    const real = realOnly(result);
    expect(real).toHaveLength(NOTIFICATION_BUDGET - 1);
    expect(real[0].fireAt).toBe(localInstant(2026, 9, 1, 9, 0));
    expect(real[real.length - 1].fireAt).toBe(
      localInstant(2026, 9, NOTIFICATION_BUDGET - 1, 9, 0),
    );
    expect(tripwireOf(result)).not.toBeNull();
  });

  it("honours a caller-supplied budget over the default", () => {
    // Ten occasions, each lingering two days: twelve days of digests.
    const reminders = dailyOccasions(10);

    // Twelve days of coverage is far too short to warrant a notice, so no slot
    // is held back for one — a budget of 3 buys three real notifications.
    expect(
      realOnly(planNotifications(reminders, POLICY_DIGEST, NOW, { budget: 3 })),
    ).toHaveLength(3);
    // Android's case: a budget far above the candidate count keeps everything.
    expect(
      planNotifications(reminders, POLICY_DIGEST, NOW, { budget: 200 }),
    ).toHaveLength(12);
    expect(
      planNotifications(reminders, POLICY_DIGEST, NOW, {
        budget: Number.POSITIVE_INFINITY,
      }),
    ).toHaveLength(12);
  });

  // The cap keeps the *soonest*, so an already-past entry must not consume a
  // slot a live one needed — filter first, then slice.
  it("drops past entries before applying the budget", () => {
    const reminders = [
      occasion("past", due({ year: 2026, month: 8, day: 1 })),
      occasion("live", due({ year: 2026, month: 9, day: 1 })),
    ];

    const result = planNotifications(reminders, POLICY_DIGEST, NOW, {
      budget: 1,
    });

    expect(result.map((n) => n.reminderId)).toEqual(["live"]);
  });

  it("plans a stored `each` exactly like `digest`", () => {
    const day = due({ year: 2026, month: 8, day: 20 });
    const reminders = [
      occasion("r1", day, { title: "Call Harry" }),
      occasion("r2", day, { title: "Gift Tilly" }),
    ];

    expect(
      planNotifications(
        reminders,
        { ...POLICY_DIGEST, mode: "each", deliveryMinutes: [540] },
        NOW,
      ),
    ).toEqual(planNotifications(reminders, POLICY_DIGEST, NOW));
  });

  it("drops today's entry once its fire time has passed", () => {
    const r = reminder({ id: "r1" });
    const afterNine = localInstant(2026, 8, 15, 10, 0);

    const ids = idsOf(planNotifications([r], POLICY_DIGEST, afterNine));

    expect(ids[0]).toBe("digest:2026-08-16@0900");
  });
});

/**
 * The service notice that coverage is about to lapse. Notifications are only
 * ever scheduled while the app runs, so a device left unopened works through
 * its plan and goes quiet — these pin the one entry that makes that legible.
 */
describe("planNotifications — the running-out notice", () => {
  /** A year of monthly reminders: long enough coverage to warrant a notice. */
  const YEAR_OF_REMINDERS = Array.from({ length: 12 }, (_, i) =>
    occasion(`r${i}`, due({ year: 2026, month: 9, day: 1 }) + i * 30 * DAY),
  );

  it("fires 30 days before the last scheduled notification", () => {
    const result = planNotifications(YEAR_OF_REMINDERS, POLICY_DIGEST, NOW);

    const real = realOnly(result);
    const coverageEnd = real[real.length - 1].fireAt;
    expect(tripwireOf(result)?.fireAt).toBe(coverageEnd - 30 * DAY);
  });

  // Warning at the edge teaches nothing actionable: ignore it and coverage ends
  // immediately. Firing early leaves a month of real notifications behind it.
  it("fires before the coverage it warns about ends", () => {
    const result = planNotifications(YEAR_OF_REMINDERS, POLICY_DIGEST, NOW);

    const tripwire = tripwireOf(result);
    expect(tripwire).not.toBeNull();
    const real = realOnly(result);
    expect(tripwire!.fireAt).toBeGreaterThan(NOW);
    expect(tripwire!.fireAt).toBeLessThan(real[real.length - 1].fireAt);
  });

  it("is worded by the copy's running-out notice", () => {
    const tripwire = tripwireOf(
      planNotifications(YEAR_OF_REMINDERS, POLICY_DIGEST, NOW),
    );

    expect(tripwire).toMatchObject(COPY.runningOut);
  });

  it("opens the app rather than any one reminder", () => {
    const tripwire = tripwireOf(
      planNotifications(YEAR_OF_REMINDERS, POLICY_DIGEST, NOW),
    );

    expect(tripwire?.reminderId).toBeNull();
  });

  // An empty app has no coverage to lose, so there is nothing to warn about —
  // and nagging someone whose app is simply empty would be re-engagement, the
  // line this notice is not allowed to cross.
  it("is absent when nothing at all is scheduled", () => {
    expect(planNotifications([], POLICY_DIGEST, NOW)).toEqual([]);
  });

  // Coverage shorter than the warning itself: a notice about tomorrow is not a
  // warning, so none is planned rather than one fired immediately.
  it("is absent when coverage ends sooner than the warning would fire", () => {
    const soon = [occasion("r1", due({ year: 2026, month: 8, day: 20 }))];

    expect(tripwireOf(planNotifications(soon, POLICY_DIGEST, NOW))).toBeNull();
  });

  // Its id is fixed so a re-plan updates the one notice in place, and its
  // fireAt tracks coverage rather than `now` — together these keep a
  // steady-state reconcile a no-op instead of churning the OS every open.
  it("is stable across re-plans at different nows", () => {
    const a = tripwireOf(
      planNotifications(YEAR_OF_REMINDERS, POLICY_DIGEST, NOW),
    );
    const later = NOW + 5 * DAY;
    const b = tripwireOf(
      planNotifications(YEAR_OF_REMINDERS, POLICY_DIGEST, later),
    );

    expect(a).toEqual(b);
  });

  it("is planned in the digest", () => {
    expect(
      tripwireOf(planNotifications(YEAR_OF_REMINDERS, POLICY_DIGEST, NOW)),
    ).not.toBeNull();
  });

  it("is absent when notifications are off", () => {
    expect(
      planNotifications(
        YEAR_OF_REMINDERS,
        { ...POLICY_DIGEST, mode: "off", deliveryMinutes: [540] },
        NOW,
      ),
    ).toEqual([]);
  });
});
