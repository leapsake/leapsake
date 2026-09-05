import { ONBOARDING_REMINDERS } from "@leapsake/core";
import {
  type ReminderRowAction,
  reminderActionsOf,
} from "@leapsake/view-models";
import { describe, expect, it } from "vitest";
import { offerFor, removalCopyFor, showsDelete } from "./reminder-row";

const NOW = 1_800_000_000_000;

/** The onboarding id for a given abstract route, from the exported convention. */
const idFor = (route: string) =>
  ONBOARDING_REMINDERS.find((r) => r.route === route)!.id;

/** A reminder as far as `reminderActionsOf` reads one. */
const reminder = (
  id: string,
  snoozeCount = 0,
  completedAt: number | null = null,
) => ({ id, completedAt, snoozeCount });

const actionsFor = (
  id: string,
  snoozeCount = 0,
  completedAt: number | null = null,
  context = {},
) => reminderActionsOf(reminder(id, snoozeCount, completedAt), context, NOW);

/** What a row offers, run through this client's mapping — the pairing under test. */
const offersFor = (actions: ReminderRowAction[]) => actions.map(offerFor);

const giftContext = {
  giftTarget: { recipientType: "person" as const, recipientId: "p1" },
};

/** What a `🗓 plan` prompt is asking about, as core's `planTargets` hands it over. */
const planContext = {
  planTarget: {
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
    ],
  },
};

describe("offerFor", () => {
  it("renders a nudge's three offers in order — do it, not now, don't ask again", () => {
    // Every step accepts at least two "not now"s, so at a count of 1 this one
    // still offers snooze *and* has earned its dismiss — the full shape.
    const actions = actionsFor(idFor("pick-self"), 1);

    expect(offersFor(actions)).toEqual([
      {
        kind: "navigate",
        path: "/people?pick=self",
        label: "Get started ›",
      },
      { kind: "snooze", until: expect.any(Number), label: "Not now" },
      { kind: "dismiss", label: "Don’t ask again" },
    ]);
  });

  it("drops the snooze once the step has spent its repetitions, keeping dismiss", () => {
    // A count past any step's budget — deliberately dial-independent, since what
    // is under test is this client's mapping, not the number itself. The row can
    // no longer be put off but must still be endable.
    const actions = actionsFor(idFor("connect-sync"), 99);

    expect(offersFor(actions)).toEqual([
      { kind: "navigate", path: "/settings", label: "Sign in ›" },
      { kind: "dismiss", label: "Don’t ask again" },
    ]);
  });

  it("offers only do-it and not-now on a first encounter", () => {
    // The binary first choice: nothing here can permanently silence the nudge.
    const actions = actionsFor(idFor("connect-sync"));

    expect(offersFor(actions).map((o) => o.kind)).toEqual([
      "navigate",
      "snooze",
    ]);
  });

  it("hands the snooze the exact date the action carried", () => {
    // The guard against a second derivation: whatever the policy chose is what
    // reaches the write, so the copy and the stored clock can never disagree.
    const actions = actionsFor(idFor("add-person"));
    const offered = actions.find((a) => a.kind === "snooze")!;
    const rendered = offersFor(actions).find((o) => o.kind === "snooze")!;

    expect(rendered.until).toBe(offered.until);
  });

  it("maps every onboarding route to a path", () => {
    for (const { route } of ONBOARDING_REMINDERS) {
      const offer = offerFor({
        kind: "cta",
        cta: { kind: "onboarding", route },
      });

      expect(offer.kind).toBe("navigate");
      expect(offer.kind === "navigate" && offer.path.startsWith("/")).toBe(
        true,
      );
      expect(offer.label).not.toBe("");
    }
  });

  it("names the two custody routes rather than sharing one generic label", () => {
    // Both push the same screen, so the label is all that separates them — and a
    // shared "Get started ›" under a row offering to get a returning user back
    // into the account they already have reads as *begin something new*.
    const offer = (route: "connect-sync" | "create-account") =>
      offerFor({ kind: "cta", cta: { kind: "onboarding", route } });

    expect(offer("connect-sync")).toEqual({
      kind: "navigate",
      path: "/settings",
      label: "Sign in ›",
    });
    expect(offer("create-account")).toEqual({
      kind: "navigate",
      path: "/settings",
      label: "Create your account ›",
    });
  });

  it("maps the duplicates row's CTA", () => {
    const actions = actionsFor("dupes", 0, null, { isDuplicatesNudge: true });

    expect(offersFor(actions)).toEqual([
      { kind: "navigate", path: "/duplicates", label: "Review ›" },
    ]);
  });

  it("maps a gift row's CTA, whose target flips once it's done", () => {
    expect(offersFor(actionsFor("gift", 0, null, giftContext))).toEqual([
      { kind: "navigate", path: "/people/p1", label: "See their gifts ›" },
    ]);
    expect(offersFor(actionsFor("gift", 0, NOW, giftContext))).toEqual([
      {
        kind: "navigate",
        // `given=1`, because this hand-off is the one that means "already
        // given" — the recipient alone cannot say so, the same person's Gifts
        // section linking here to add one they haven't.
        path: "/gifts/new?recipient=person%3Ap1&given=1",
        label: "Record what you gave ›",
      },
    ]);
  });

  it("sends a pet's gifts to the pets tree, not people", () => {
    expect(
      offerFor({
        kind: "cta",
        cta: {
          kind: "gift",
          action: "see-gifts",
          recipientType: "pet",
          recipientId: "x1",
        },
      }),
    ).toEqual({
      kind: "navigate",
      path: "/pets/x1",
      label: "See their gifts ›",
    });
  });

  // ⚠️ The prompt's CTA navigates **nowhere**. Mobile's Home row is a checkbox
  // and a link, so the offer set is rendered on the detail screen this offer
  // already belongs to, rather than on a screen further in.
  it("answers a prompt in place, with the one-tap answer beside it", () => {
    expect(offersFor(actionsFor("prompt", 0, null, planContext))).toEqual([
      { kind: "answer-prompt", label: "Choose below" },
      {
        kind: "answer-plan",
        milestoneId: "m1",
        // The **whole** offer set, wish alone enabled — not just the tick.
        schedule: [
          { action: "get:gift", label: null, offsetDays: 12, enabled: false },
          { action: "wish", label: null, offsetDays: 0, enabled: true },
        ],
        label: "Just the day",
      },
      { kind: "snooze", until: expect.any(Number), label: "Not now" },
    ]);
  });

  it("offers nothing at all on an ordinary reminder", () => {
    expect(offersFor(actionsFor("user-written"))).toEqual([]);
  });
});

describe("showsDelete", () => {
  it("withholds Delete from an open nudge on its first encounter", () => {
    // The first encounter is a genuinely binary choice — do it, or not now.
    // Delete is the permanent option under a label that hides what it does.
    const actions = actionsFor(idFor("connect-sync"));

    expect(actions.map((a) => a.kind)).toEqual(["cta", "snooze"]);
    expect(showsDelete(actions, false)).toBe(false);
  });

  it("withholds Delete once the nudge offers its own dismiss", () => {
    // Otherwise the screen shows two buttons for the one tombstone.
    const actions = actionsFor(idFor("connect-sync"), 1);

    expect(actions.map((a) => a.kind)).toContain("dismiss");
    expect(showsDelete(actions, false)).toBe(false);
  });

  it("keeps Delete on a completed nudge, whose offers collapse to the CTA", () => {
    // Without this, marking a nudge done would strand it at the foot of the list
    // with no way to be rid of it.
    const actions = actionsFor(idFor("connect-sync"), 1, NOW);

    expect(actions.map((a) => a.kind)).toEqual(["cta"]);
    expect(showsDelete(actions, true)).toBe(true);
  });

  it("keeps Delete on an ordinary reminder, which offers nothing", () => {
    expect(showsDelete(actionsFor("user-written"), false)).toBe(true);
  });

  it("keeps Delete on gift and duplicates reminders", () => {
    expect(showsDelete(actionsFor("gift", 0, null, giftContext), false)).toBe(
      true,
    );
    expect(
      showsDelete(
        actionsFor("dupes", 0, null, { isDuplicatesNudge: true }),
        false,
      ),
    ).toBe(true);
  });
});

describe("removalCopyFor", () => {
  it("asks whether to stop asking, on a nudge", () => {
    const copy = removalCopyFor(actionsFor(idFor("connect-sync"), 1));

    expect(copy.title).toBe("Stop asking about this?");
    expect(copy.confirm).toBe("Don’t ask again");
    expect(copy.message("Set up sync")).toBe(
      "Leapsake won’t ask about “Set up sync” again.",
    );
  });

  it("still says the honest thing on a completed nudge, reached via Delete", () => {
    // The copy branches on the reminder, not on which affordance was tapped, so
    // the one remaining route to the tombstone can't bypass it.
    const copy = removalCopyFor(actionsFor(idFor("connect-sync"), 1, NOW));

    expect(copy.title).toBe("Stop asking about this?");
  });

  // A prompt is the same shape of thing as a nudge: a question Leapsake asked
  // unbidden, whose removal has always been a permanent tombstone.
  it("says the honest thing on a prompt too", () => {
    const copy = removalCopyFor(actionsFor("prompt", 1, null, planContext));

    expect(copy.title).toBe("Stop asking about this?");
    expect(copy.confirm).toBe("Don’t ask again");
  });

  it("asks about deletion on a user's own reminder", () => {
    const copy = removalCopyFor(actionsFor("user-written"));

    expect(copy.title).toBe("Delete reminder");
    expect(copy.confirm).toBe("Delete");
    expect(copy.message("Call Ana")).toBe("Delete “Call Ana”?");
  });

  it("asks about deletion on gift and duplicates rows", () => {
    expect(removalCopyFor(actionsFor("gift", 0, null, giftContext)).title).toBe(
      "Delete reminder",
    );
    expect(
      removalCopyFor(actionsFor("dupes", 0, null, { isDuplicatesNudge: true }))
        .title,
    ).toBe("Delete reminder");
  });
});
