import { type CivilDate, dueDateMs } from "@leapsake/schema";
import { ONBOARDING_REMINDERS } from "@leapsake/reminders";
import { describe, expect, it } from "vitest";
import {
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
        title: "Wish Alice a happy birthday",
        dueDate: due(day2),
      }),
      reminder({ id: "r2", title: "Call Bob", dueDate: due(day1) }),
      reminder({ id: "r3", title: "Gift Carol", dueDate: due(day1) }),
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

  it("each mode caps to the soonest NOTIFICATION_BUDGET", () => {
    const reminders = Array.from({ length: NOTIFICATION_BUDGET + 5 }, (_, i) =>
      reminder({
        id: `r${i}`,
        dueDate: due({ year: 2026, month: 9, day: 1 + i }),
      }),
    );

    const result = planNotifications(reminders, POLICY_EACH, NOW);

    expect(result).toHaveLength(NOTIFICATION_BUDGET);
    expect(result[0].reminderId).toBe("r0");
    expect(result[NOTIFICATION_BUDGET - 1].reminderId).toBe(
      `r${NOTIFICATION_BUDGET - 1}`,
    );
  });

  it("drops entries whose fire time has already passed now", () => {
    const past: CivilDate = { year: 2026, month: 8, day: 10 };
    const r = reminder({ id: "r1", dueDate: due(past) });
    const now = localInstant(2026, 8, 15, 8, 0); // well after Aug 10, 09:00

    expect(planNotifications([r], POLICY_DIGEST, now)).toEqual([]);
  });
});
