import { ONBOARDING_REMINDERS } from "@leapsake/reminders";
import { describe, expect, it } from "vitest";
import { reminderOfferLabelOf, reminderRowOf } from "./reminder-row.js";
import { type ReminderCta, reminderActionsOf } from "./reminders.js";

const NOW = 1_800_000_000_000;

const idFor = (route: string) =>
  ONBOARDING_REMINDERS.find((r) => r.route === route)!.id;

/** A dateless reminder's actions, so every "Remind me in…" preset fits. */
const actionsFor = (
  id: string,
  completedAt: number | null = null,
  context = {},
) => reminderActionsOf({ id, completedAt }, context, NOW);

const giftContext = {
  giftTarget: { recipientType: "person" as const, recipientId: "p1" },
};

const planContext = {
  planTarget: {
    milestoneId: "m1",
    milestoneKind: "birthday" as const,
    offers: [
      { action: "wish" as const, label: null, offsetDays: 0, enabled: true },
    ],
  },
};

const ctaLabel = (cta: ReminderCta) =>
  reminderOfferLabelOf({ kind: "cta", cta });

describe("reminderOfferLabelOf", () => {
  it("labels a nudge's offers in order: do it, remind me in…, don't ask again", () => {
    expect(actionsFor(idFor("about-you")).map(reminderOfferLabelOf)).toEqual([
      "aboutYou",
      "remindMe",
      "remindMe",
      "remindMe",
      "dismiss",
    ]);
  });

  it("names each onboarding route", () => {
    expect(
      ONBOARDING_REMINDERS.map(({ route }) =>
        ctaLabel({ kind: "onboarding", route }),
      ),
    ).toEqual(
      ONBOARDING_REMINDERS.map(
        ({ route }) =>
          ({
            import: "import",
            "create-account": "createAccount",
            "enable-notifications": "enableNotifications",
            "about-you": "aboutYou",
          })[route],
      ),
    );
  });

  it("flips a gift row's label once it's done", () => {
    expect(
      actionsFor("gift", null, giftContext).map(reminderOfferLabelOf),
    ).toEqual(["seeGifts", "remindMe", "remindMe", "remindMe"]);
    expect(
      actionsFor("gift", NOW, giftContext).map(reminderOfferLabelOf),
    ).toEqual(["recordGiving"]);
  });

  it("offers a prompt its choice and its one-tap answer", () => {
    expect(
      actionsFor("prompt", null, planContext).map(reminderOfferLabelOf),
    ).toEqual([
      "choosePlan",
      "justTheDay",
      "remindMe",
      "remindMe",
      "remindMe",
      "stopAsking",
    ]);
  });

  it("asks your own wedding for a spouse and your own first date for a partner", () => {
    const partner = {
      kind: "link-partner" as const,
      milestoneId: "m1",
      personId: "p1",
    };
    expect(
      ctaLabel({ ...partner, milestoneKind: "wedding", isSelf: false }),
    ).toBe("linkPartner");
    expect(
      ctaLabel({ ...partner, milestoneKind: "wedding", isSelf: true }),
    ).toBe("linkSpouse");
    expect(
      ctaLabel({ ...partner, milestoneKind: "first-date", isSelf: true }),
    ).toBe("linkOwnPartner");
  });

  it("labels the duplicates, contact and partnership CTAs", () => {
    expect(ctaLabel({ kind: "duplicates" })).toBe("duplicates");
    expect(ctaLabel({ kind: "contact", personId: "p1" })).toBe("addContact");
    expect(
      ctaLabel({
        kind: "partnership",
        relationshipId: "r1",
        milestoneKind: "wedding",
        partnerId: "p2",
      }),
    ).toBe("addDate");
  });
});

describe("reminderRowOf", () => {
  it("withholds Remove from an open nudge, whose own dismiss is the same tombstone", () => {
    const actions = actionsFor(idFor("create-account"));

    expect(actions.map((a) => a.kind)).toContain("dismiss");
    expect(reminderRowOf(actions, false)).toEqual({
      completable: false,
      showsRemove: false,
      removal: "dismiss",
    });
  });

  it("keeps Remove on a completed nudge, still worded as don't ask again", () => {
    const actions = actionsFor(idFor("create-account"), NOW);

    expect(actions.map((a) => a.kind)).toEqual(["cta"]);
    expect(reminderRowOf(actions, true)).toEqual({
      completable: false,
      showsRemove: true,
      removal: "dismiss",
    });
  });

  it("treats a prompt like a nudge", () => {
    expect(
      reminderRowOf(actionsFor("prompt", null, planContext), false),
    ).toEqual({ completable: false, showsRemove: false, removal: "dismiss" });
  });

  it("keeps an ordinary, gift or duplicates reminder's Remove and plain wording", () => {
    for (const actions of [
      actionsFor("user-written"),
      actionsFor("gift", null, giftContext),
      actionsFor("dupes", null, { isDuplicatesNudge: true }),
    ]) {
      expect(reminderRowOf(actions, false)).toMatchObject({
        showsRemove: true,
        removal: "remove",
      });
    }
  });

  it("lets only an errand be completed, not a nudge, prompt or the duplicates review", () => {
    const completable = (actions: ReturnType<typeof actionsFor>) =>
      reminderRowOf(actions, false).completable;

    expect(completable(actionsFor("user-written"))).toBe(true);
    expect(completable(actionsFor("gift", null, giftContext))).toBe(true);
    expect(completable(actionsFor(idFor("import")))).toBe(false);
    expect(completable(actionsFor("prompt", null, planContext))).toBe(false);
    expect(
      completable(actionsFor("dupes", null, { isDuplicatesNudge: true })),
    ).toBe(false);
  });
});
