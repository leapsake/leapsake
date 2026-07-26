import { ONBOARDING_REMINDERS } from "@leapsake/reminders";
import { describe, expect, it } from "vitest";
import { partitionReminders, reminderCtaOf } from "./reminders.js";

const reminder = (
  id: string,
  standing: {
    completedAt?: number | null;
    dueDate?: number | null;
    createdAt?: number;
  },
) => ({
  id,
  completedAt: standing.completedAt ?? null,
  dueDate: standing.dueDate ?? null,
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
    ];
    partitionReminders(reminders);

    expect(reminders.map((r) => r.id)).toEqual(["undated", "due"]);
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
