import { ONBOARDING_REMINDERS, snoozePolicyOf } from "@leapsake/reminders";
import { describe, expect, it } from "vitest";
import {
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
