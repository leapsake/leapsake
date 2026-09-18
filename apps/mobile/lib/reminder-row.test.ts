import { ONBOARDING_REMINDERS } from "@leapsake/core";
import {
  type ReminderRowAction,
  reminderActionsOf,
} from "@leapsake/view-models";
import { describe, expect, it } from "vitest";
import {
  isAnsweredInline,
  offerFor,
  removalCopyFor,
  showsDelete,
} from "./reminder-row";

const NOW = 1_800_000_000_000;

/** The onboarding id for a given abstract route, from the exported convention. */
const idFor = (route: string) =>
  ONBOARDING_REMINDERS.find((r) => r.route === route)!.id;

/** A reminder as far as `reminderActionsOf` reads one — dateless, so every
 *  "Remind me in…" preset fits. */
const reminder = (id: string, completedAt: number | null = null) => ({
  id,
  completedAt,
});

const actionsFor = (
  id: string,
  completedAt: number | null = null,
  context = {},
) => reminderActionsOf(reminder(id, completedAt), context, NOW);

/** What a row offers, run through this client's mapping — the pairing under test. */
const offersFor = (actions: ReminderRowAction[]) =>
  actions.map((action) => offerFor(action));

/** The three "Remind me in…" buttons a row with no deadline offers. Each says
 *  how long it lasts: "Not now" alone never distinguished an afternoon from
 *  forever — the ambiguity "Don't ask again" was introduced to fix at the other
 *  end. */
const REMIND_ME = [
  { kind: "snooze", days: 1, label: "Remind me tomorrow" },
  { kind: "snooze", days: 3, label: "Remind me in 3 days" },
  { kind: "snooze", days: 7, label: "Remind me next week" },
];

const giftContext = {
  giftTarget: { recipientType: "person" as const, recipientId: "p1" },
};

/** What a `🗓 plan` prompt is asking about, as core's `reminders.targets` hands it over. */
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
  it("renders a nudge's offers in order — do it, remind me in…, don't ask again", () => {
    expect(offersFor(actionsFor(idFor("about-you")))).toEqual([
      { kind: "navigate", path: "/about-you", label: "Get started ›" },
      ...REMIND_ME,
      { kind: "dismiss", label: "Don’t ask again" },
    ]);
  });

  it("hands each snooze the day count its action carried", () => {
    // Core turns the count into a day when the write is made, by the rule that
    // offered it — so nothing here derives a date.
    const actions = actionsFor(idFor("import"));
    const offered = actions.flatMap((a) =>
      a.kind === "snooze" ? [a.days] : [],
    );
    const rendered = offersFor(actions).flatMap((o) =>
      o.kind === "snooze" ? [o.days] : [],
    );

    expect(rendered).toEqual(offered);
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

  it("names the import route, whose title no longer carries the verb", () => {
    // The title says "Import your contacts"; "Get started ›" under it would ask
    // the reader to join the two up.
    expect(
      offerFor({ kind: "cta", cta: { kind: "onboarding", route: "import" } }),
    ).toEqual({
      kind: "navigate",
      path: "/import",
      label: "Import ›",
    });
  });

  it("maps the duplicates row's CTA", () => {
    const actions = actionsFor("dupes", null, { isDuplicatesNudge: true });

    expect(offersFor(actions)).toEqual([
      { kind: "navigate", path: "/duplicates", label: "Review ›" },
      ...REMIND_ME,
    ]);
  });

  it("maps a gift row's CTA, whose target flips once it's done", () => {
    expect(offersFor(actionsFor("gift", null, giftContext))).toEqual([
      { kind: "navigate", path: "/people/p1", label: "See their gifts ›" },
      ...REMIND_ME,
    ]);
    expect(offersFor(actionsFor("gift", NOW, giftContext))).toEqual([
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

  // ⚠️ Straight to the form, not to the person's page. The CTA is shown
  // precisely because they have no methods, so their page would open on an empty
  // Contact section and cost one more tap to reach the same place — a difference
  // from desktop, which has no such route.
  it("sends the collect prompt straight to the add-contact form", () => {
    expect(
      offerFor({ kind: "cta", cta: { kind: "contact", personId: "p1" } }),
    ).toEqual({
      kind: "navigate",
      path: "/people/p1/contacts/new",
      label: "Add a way to reach them ›",
    });
  });

  // ⚠️ The prompt's CTA navigates **nowhere**. Mobile's Home row is a link, so
  // the offer set is rendered on the detail screen this offer already belongs
  // to, rather than on a screen further in.
  it("answers a prompt in place, with the one-tap answer beside it", () => {
    expect(offersFor(actionsFor("prompt", null, planContext))).toEqual([
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
      ...REMIND_ME,
      { kind: "dismiss", label: "Don’t ask again" },
    ]);
  });

  it("offers an ordinary reminder only its put-offs", () => {
    expect(offersFor(actionsFor("user-written"))).toEqual(REMIND_ME);
  });
});

describe("isAnsweredInline", () => {
  // Both are answers the detail screen's own form already carries: "Choose
  // below" is desktop's navigation to a screen mobile does not have, and "Just
  // the day" writes exactly what Save writes with the offers untouched. Drawn as
  // buttons they were two more blue words for one outcome, one of them inert.
  it("claims the prompt's CTA and its one-tap answer, and nothing else", () => {
    const actions = actionsFor("prompt", null, planContext);

    expect(actions.filter(isAnsweredInline).map((a) => a.kind)).toEqual([
      "cta",
      "answer-plan",
    ]);
    // What survives is the escapes — which is the whole of what the screen still
    // needs to draw beside Save.
    expect(
      actions.filter((a) => !isAnsweredInline(a)).map((a) => a.kind),
    ).toEqual(["snooze", "snooze", "snooze", "dismiss"]);
  });

  it("leaves an ordinary nudge's offers alone", () => {
    // A nudge's CTA goes somewhere real; only a `plan` prompt is answered here.
    expect(actionsFor(idFor("about-you")).some(isAnsweredInline)).toBe(false);
  });
});

describe("showsDelete", () => {
  it("withholds Delete from an open nudge, which offers its own dismiss", () => {
    // Otherwise the screen shows two buttons for the one tombstone.
    const actions = actionsFor(idFor("create-account"));

    expect(actions.map((a) => a.kind)).toContain("dismiss");
    expect(showsDelete(actions, false)).toBe(false);
  });

  it("keeps Delete on a completed nudge, whose offers collapse to the CTA", () => {
    // Without this, marking a nudge done would strand it at the foot of the list
    // with no way to be rid of it.
    const actions = actionsFor(idFor("create-account"), NOW);

    expect(actions.map((a) => a.kind)).toEqual(["cta"]);
    expect(showsDelete(actions, true)).toBe(true);
  });

  it("keeps Delete on an ordinary reminder, which offers only put-offs", () => {
    expect(showsDelete(actionsFor("user-written"), false)).toBe(true);
  });

  it("keeps Delete on gift and duplicates reminders", () => {
    expect(showsDelete(actionsFor("gift", null, giftContext), false)).toBe(
      true,
    );
    expect(
      showsDelete(
        actionsFor("dupes", null, { isDuplicatesNudge: true }),
        false,
      ),
    ).toBe(true);
  });
});

describe("removalCopyFor", () => {
  it("asks whether to stop asking, on a nudge", () => {
    const copy = removalCopyFor(actionsFor(idFor("create-account")));

    expect(copy.title).toBe("Stop asking about this?");
    expect(copy.confirm).toBe("Don’t ask again");
    expect(copy.message("Set up sync")).toBe(
      "Leapsake won’t ask about “Set up sync” again.",
    );
  });

  it("still says the honest thing on a completed nudge, reached via Delete", () => {
    // The copy branches on the reminder, not on which affordance was tapped, so
    // the one remaining route to the tombstone can't bypass it.
    const copy = removalCopyFor(actionsFor(idFor("create-account"), NOW));

    expect(copy.title).toBe("Stop asking about this?");
  });

  // A prompt is the same shape of thing as a nudge: a question Leapsake asked
  // unbidden, whose removal has always been a permanent tombstone.
  it("says the honest thing on a prompt too", () => {
    const copy = removalCopyFor(actionsFor("prompt", null, planContext));

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
    expect(removalCopyFor(actionsFor("gift", null, giftContext)).title).toBe(
      "Delete reminder",
    );
    expect(
      removalCopyFor(actionsFor("dupes", null, { isDuplicatesNudge: true }))
        .title,
    ).toBe("Delete reminder");
  });
});
