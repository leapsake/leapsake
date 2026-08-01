import { ONBOARDING_REMINDERS } from "@leapsake/reminders";
import { describe, expect, it } from "vitest";
import { partitionReminders, reminderCtaOf } from "./reminders.js";

const reminder = (
  id: string,
  standing: {
    completedAt?: number | null;
    dueDate?: number | null;
    snoozedUntil?: number | null;
    createdAt?: number;
  },
) => ({
  id,
  completedAt: standing.completedAt ?? null,
  dueDate: standing.dueDate ?? null,
  snoozedUntil: standing.snoozedUntil ?? null,
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
