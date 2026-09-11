import { type CivilDate, dueDateMs } from "@leapsake/schema";
import { ONBOARDING_REMINDERS } from "@leapsake/reminders";
import { describe, expect, it } from "vitest";
import {
  type DesiredNotification,
  NOTIFICATION_BUDGET,
  type NotifiableReminder,
  planNotifications,
} from "../src/index.js";

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

/** A minimal notifiable reminder, everything defaulted to "would notify". */
function reminder(
  overrides: Partial<NotifiableReminder> & { id: string },
): NotifiableReminder {
  return {
    title: "Reminder",
    body: null,
    dueDate: null,
    completedAt: null,
    snoozedUntil: null,
    deletedAt: null,
    ...overrides,
  };
}

const POLICY_DIGEST = { mode: "digest" as const, deliveryMinute: 540 }; // 09:00
const POLICY_EACH = { mode: "each" as const, deliveryMinute: 540 };
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
      planNotifications([r], { mode: "off", deliveryMinute: 540 }, NOW),
    ).toEqual([]);
  });

  it("digest bundles same-day reminders into one entry and sorts by day", () => {
    const day1: CivilDate = { year: 2026, month: 8, day: 16 };
    const day2: CivilDate = { year: 2026, month: 8, day: 20 };
    const reminders = [
      reminder({
        id: "r1",
        title: "Wish Violet a happy birthday",
        dueDate: due(day2),
      }),
      reminder({ id: "r2", title: "Call Harry", dueDate: due(day1) }),
      reminder({ id: "r3", title: "Gift Tilly", dueDate: due(day1) }),
    ];

    const result = planNotifications(reminders, POLICY_DIGEST, NOW);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "digest:2026-08-16",
      fireAt: localInstant(2026, 8, 16, 9, 0),
      // Two reminders that day — no single tap target.
      reminderId: null,
    });
    expect(result[1]).toMatchObject({
      id: "digest:2026-08-20",
      fireAt: localInstant(2026, 8, 20, 9, 0),
      // Exactly one reminder that day — taps straight through to it.
      reminderId: "r1",
    });
  });

  it("excludes completed, deleted, currently-snoozed, dateless, and onboarding rows", () => {
    const dueDay = due({ year: 2026, month: 8, day: 20 });
    const reminders: NotifiableReminder[] = [
      reminder({ id: "keep", dueDate: dueDay }),
      reminder({ id: "no-date", dueDate: null }),
      reminder({ id: "done", dueDate: dueDay, completedAt: NOW }),
      reminder({ id: "gone", dueDate: dueDay, deletedAt: NOW }),
      reminder({
        id: "snoozed-future",
        dueDate: dueDay,
        snoozedUntil: NOW + 1000,
      }),
      // A snooze that has already elapsed no longer suppresses the reminder.
      reminder({
        id: "snoozed-past",
        dueDate: dueDay,
        snoozedUntil: NOW - 1000,
      }),
      reminder({ id: ONBOARDING_REMINDERS[0].id, dueDate: dueDay }),
    ];

    const result = planNotifications(reminders, POLICY_EACH, NOW);

    expect(result.map((n) => n.reminderId).sort()).toEqual(
      ["keep", "snoozed-past"].sort(),
    );
  });

  it("each mode caps to the soonest NOTIFICATION_BUDGET, notice included", () => {
    const reminders = Array.from({ length: NOTIFICATION_BUDGET + 5 }, (_, i) =>
      reminder({
        id: `r${i}`,
        dueDate: due({ year: 2026, month: 9, day: 1 + i }),
      }),
    );

    const result = planNotifications(reminders, POLICY_EACH, NOW);

    // The budget is the whole plan, the service notice included — overshooting
    // it by one would be the silent iOS drop the budget exists to prevent.
    expect(result).toHaveLength(NOTIFICATION_BUDGET);
    const real = realOnly(result);
    expect(real).toHaveLength(NOTIFICATION_BUDGET - 1);
    expect(real[0].reminderId).toBe("r0");
    expect(real[real.length - 1].reminderId).toBe(
      `r${NOTIFICATION_BUDGET - 2}`,
    );
    expect(tripwireOf(result)).not.toBeNull();
  });

  // The horizon that makes digest hard to overshoot bounds `system` reminders
  // only; enough far-future `user` ones on distinct days would sail past iOS's
  // ceiling if the cap were still `each`-only, as it originally was.
  it("digest mode caps to the soonest NOTIFICATION_BUDGET too", () => {
    const reminders = Array.from({ length: NOTIFICATION_BUDGET + 5 }, (_, i) =>
      reminder({
        id: `r${i}`,
        // One per distinct day, so each lands in its own digest bucket.
        dueDate: due({ year: 2026, month: 9, day: 1 }) + i * 86_400_000,
      }),
    );

    const result = planNotifications(reminders, POLICY_DIGEST, NOW);

    expect(result).toHaveLength(NOTIFICATION_BUDGET);
    expect(result[0].id).toBe("digest:2026-09-01");
  });

  it("honours a caller-supplied budget over the default", () => {
    const reminders = Array.from({ length: 10 }, (_, i) =>
      reminder({
        id: `r${i}`,
        dueDate: due({ year: 2026, month: 9, day: 1 + i }),
      }),
    );

    // Ten days of coverage is far too short to warrant a notice, so no slot is
    // held back for one — a budget of 3 buys three real notifications.
    expect(
      realOnly(planNotifications(reminders, POLICY_EACH, NOW, { budget: 3 })),
    ).toHaveLength(3);
    // Android's case: a budget far above the candidate count keeps everything.
    expect(
      planNotifications(reminders, POLICY_EACH, NOW, { budget: 200 }),
    ).toHaveLength(10);
    expect(
      planNotifications(reminders, POLICY_EACH, NOW, {
        budget: Number.POSITIVE_INFINITY,
      }),
    ).toHaveLength(10);
  });

  // The cap keeps the *soonest*, so an already-past entry must not consume a
  // slot a live one needed — filter first, then slice.
  it("drops past entries before applying the budget", () => {
    const reminders = [
      reminder({ id: "past", dueDate: due({ year: 2026, month: 8, day: 1 }) }),
      reminder({ id: "live", dueDate: due({ year: 2026, month: 9, day: 1 }) }),
    ];

    const result = planNotifications(reminders, POLICY_EACH, NOW, {
      budget: 1,
    });

    expect(result.map((n) => n.reminderId)).toEqual(["live"]);
  });

  it("drops entries whose fire time has already passed now", () => {
    const past: CivilDate = { year: 2026, month: 8, day: 10 };
    const r = reminder({ id: "r1", dueDate: due(past) });
    const now = localInstant(2026, 8, 15, 8, 0); // well after Aug 10, 09:00

    expect(planNotifications([r], POLICY_DIGEST, now)).toEqual([]);
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
    reminder({
      id: `r${i}`,
      dueDate: due({ year: 2026, month: 9, day: 1 }) + i * 30 * DAY,
    }),
  );

  it("fires 30 days before the last scheduled notification", () => {
    const result = planNotifications(YEAR_OF_REMINDERS, POLICY_EACH, NOW);

    const real = realOnly(result);
    const coverageEnd = real[real.length - 1].fireAt;
    expect(tripwireOf(result)?.fireAt).toBe(coverageEnd - 30 * DAY);
  });

  // Warning at the edge teaches nothing actionable: ignore it and coverage ends
  // immediately. Firing early leaves a month of real notifications behind it.
  it("fires before the coverage it warns about ends", () => {
    const result = planNotifications(YEAR_OF_REMINDERS, POLICY_EACH, NOW);

    const tripwire = tripwireOf(result);
    expect(tripwire).not.toBeNull();
    const real = realOnly(result);
    expect(tripwire!.fireAt).toBeGreaterThan(NOW);
    expect(tripwire!.fireAt).toBeLessThan(real[real.length - 1].fireAt);
  });

  it("opens the app rather than any one reminder", () => {
    const tripwire = tripwireOf(
      planNotifications(YEAR_OF_REMINDERS, POLICY_EACH, NOW),
    );

    expect(tripwire?.reminderId).toBeNull();
  });

  // An empty app has no coverage to lose, so there is nothing to warn about —
  // and nagging someone whose app is simply empty would be re-engagement, the
  // line this notice is not allowed to cross.
  it("is absent when nothing at all is scheduled", () => {
    expect(planNotifications([], POLICY_EACH, NOW)).toEqual([]);
  });

  // Coverage shorter than the warning itself: a notice about tomorrow is not a
  // warning, so none is planned rather than one fired immediately.
  it("is absent when coverage ends sooner than the warning would fire", () => {
    const soon = [
      reminder({ id: "r1", dueDate: due({ year: 2026, month: 8, day: 20 }) }),
    ];

    expect(tripwireOf(planNotifications(soon, POLICY_EACH, NOW))).toBeNull();
  });

  // Its id is fixed so a re-plan updates the one notice in place, and its
  // fireAt tracks coverage rather than `now` — together these keep a
  // steady-state reconcile a no-op instead of churning the OS every open.
  it("is stable across re-plans at different nows", () => {
    const a = tripwireOf(
      planNotifications(YEAR_OF_REMINDERS, POLICY_EACH, NOW),
    );
    const later = NOW + 5 * DAY;
    const b = tripwireOf(
      planNotifications(YEAR_OF_REMINDERS, POLICY_EACH, later),
    );

    expect(a).toEqual(b);
  });

  it("is planned in digest mode too", () => {
    expect(
      tripwireOf(planNotifications(YEAR_OF_REMINDERS, POLICY_DIGEST, NOW)),
    ).not.toBeNull();
  });

  it("is absent when notifications are off", () => {
    expect(
      planNotifications(
        YEAR_OF_REMINDERS,
        { mode: "off", deliveryMinute: 540 },
        NOW,
      ),
    ).toEqual([]);
  });
});
