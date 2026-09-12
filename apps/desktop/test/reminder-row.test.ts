import { ONBOARDING_REMINDERS } from "@leapsake/core";
import {
  type ReminderRowAction,
  reminderActionsOf,
} from "@leapsake/view-models";
import { describe, expect, it } from "vitest";
import {
  ctaLinkFor,
  rowAffordanceFor,
  showsRemove,
} from "../src/renderer/src/lib/reminder-row.js";

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
  ],
};

/** What a row offers, run through this client's mapping — the pairing under test. */
const affordancesFor = (actions: ReminderRowAction[], id: string) =>
  actions.map((a) => rowAffordanceFor(a, id));

/** The three "Remind me in…" posts a row with no deadline offers. */
const remindMe = (id: string) => [
  {
    kind: "snooze",
    to: `/reminders/${id}/snooze`,
    days: 1,
    label: "Remind me tomorrow",
  },
  {
    kind: "snooze",
    to: `/reminders/${id}/snooze`,
    days: 3,
    label: "Remind me in 3 days",
  },
  {
    kind: "snooze",
    to: `/reminders/${id}/snooze`,
    days: 7,
    label: "Remind me next week",
  },
];

describe("rowAffordanceFor", () => {
  it("renders a nudge's offers in order — do it, remind me in…, don't ask again", () => {
    const id = idFor("about-you");
    const actions = reminderActionsOf(reminder(id), {}, NOW);

    expect(affordancesFor(actions, id)).toEqual([
      { kind: "link", to: "/people?pick=self", label: "Pick yourself →" },
      ...remindMe(id),
      {
        kind: "link",
        to: `/reminders/${id}/delete`,
        label: "Don’t ask again",
      },
    ]);
  });

  it("hands each snooze the day count its action carried", () => {
    // Core turns the count into a day when the write is made, by the rule that
    // offered it — so nothing here derives a date.
    const id = idFor("import");
    const actions = reminderActionsOf(reminder(id), {}, NOW);
    const offered = actions.flatMap((a) =>
      a.kind === "snooze" ? [a.days] : [],
    );
    const rendered = affordancesFor(actions, id).flatMap((a) =>
      a.kind === "snooze" ? [a.days] : [],
    );

    expect(rendered).toEqual(offered);
  });

  it("sends dismiss to the same route as Remove — one tombstone, one screen", () => {
    const id = idFor("connect-sync");
    const actions = reminderActionsOf(reminder(id), {}, NOW);
    const dismiss = affordancesFor(actions, id).at(-1)!;

    expect(dismiss).toEqual({
      kind: "link",
      to: `/reminders/${id}/delete`,
      label: "Don’t ask again",
    });
  });

  it("maps a gift row's CTA, whose target flips once it's done", () => {
    const giftTarget = { recipientType: "person" as const, recipientId: "p1" };
    const open = reminderActionsOf(reminder("gift"), { giftTarget }, NOW);
    const done = reminderActionsOf(reminder("gift", NOW), { giftTarget }, NOW);

    expect(affordancesFor(open, "gift")).toEqual([
      { kind: "link", to: "/people/p1", label: "See their gifts →" },
      ...remindMe("gift"),
    ]);
    expect(affordancesFor(done, "gift")).toEqual([
      {
        kind: "link",
        to: "/gifts/new?recipient=person%3Ap1",
        label: "Record what you gave →",
      },
    ]);
  });

  // ⚠️ The one-tap answer is a **post on the row**, not a link. The prompt
  // trades several passive rows for one that asks a question, and that only
  // pays off if the common answer costs less than ignoring the old rows did.
  it("puts a prompt's one-tap answer on the row, beside the link to the rest", () => {
    const actions = reminderActionsOf(reminder("prompt"), { planTarget }, NOW);

    expect(affordancesFor(actions, "prompt")).toEqual([
      { kind: "link", to: "/milestones/m1/plan", label: "Choose →" },
      {
        kind: "answer-plan",
        to: "/milestones/m1/plan",
        // The **whole** offer set, wish alone enabled — not just the tick. Rows
        // existing is what makes "asked, and chose nothing" distinguishable
        // from "never asked".
        schedule: [
          { action: "get:gift", label: null, offsetDays: 12, enabled: false },
          { action: "wish", label: null, offsetDays: 0, enabled: true },
        ],
        label: "Just the day",
      },
      ...remindMe("prompt"),
      {
        kind: "link",
        to: "/reminders/prompt/delete",
        label: "Don’t ask again",
      },
    ]);
  });

  it("maps the duplicates row's CTA", () => {
    const actions = reminderActionsOf(
      reminder("dupes"),
      { isDuplicatesNudge: true },
      NOW,
    );

    expect(affordancesFor(actions, "dupes")).toEqual([
      { kind: "link", to: "/duplicates", label: "Review duplicates →" },
      ...remindMe("dupes"),
    ]);
  });
});

describe("ctaLinkFor", () => {
  it("maps every onboarding route", () => {
    for (const { id, route } of ONBOARDING_REMINDERS) {
      const link = ctaLinkFor({ kind: "onboarding", route });
      expect(link.path.startsWith("/")).toBe(true);
      expect(link.label).not.toBe("");
      // Sanity: the id and the route are the two halves of the same convention.
      expect(id).toBeTruthy();
    }
    expect(ctaLinkFor({ kind: "onboarding", route: "about-you" })).toEqual({
      path: "/people?pick=self",
      label: "Pick yourself →",
    });
  });

  it("words the two custody routes as a fork, though they share a screen", () => {
    // Both land on Settings, which renders create-account above sign-in while the
    // store has no account — so the *labels* are what tell a returning user which
    // row is theirs. "Connect to sync" is our vocabulary; they are looking for
    // the words "sign in", and taking the wrong one used to be a dead end.
    const signIn = ctaLinkFor({ kind: "onboarding", route: "connect-sync" });
    const create = ctaLinkFor({ kind: "onboarding", route: "create-account" });

    expect(signIn).toEqual({ path: "/settings", label: "Sign in →" });
    expect(create).toEqual({
      path: "/settings",
      label: "Create your account →",
    });
    expect(signIn.label).not.toBe(create.label);
  });

  it("sends a pet's gifts to the pets tree, not people", () => {
    expect(
      ctaLinkFor({
        kind: "gift",
        action: "see-gifts",
        recipientType: "pet",
        recipientId: "x1",
      }),
    ).toEqual({ path: "/pets/x1", label: "See their gifts →" });
  });

  // ⚠️ The person's own page, not a form: desktop adds contact methods from the
  // Contact section there, and unlike mobile it has no route that opens straight
  // into an empty one. The copy is an offer of help, not a missing field — the
  // reminder is completable without it.
  it("sends the collect prompt to the person's page", () => {
    expect(ctaLinkFor({ kind: "contact", personId: "p1" })).toEqual({
      path: "/people/p1",
      label: "Add a way to reach them →",
    });
  });
});

describe("showsRemove", () => {
  const actionsFor = (id: string, completedAt: number | null = null) =>
    reminderActionsOf(reminder(id, completedAt), {}, NOW);

  it("withholds Remove from an open nudge, which offers its own dismiss", () => {
    // Otherwise the row shows two buttons for the one tombstone.
    const actions = actionsFor(idFor("connect-sync"));

    expect(actions.map((a) => a.kind)).toContain("dismiss");
    expect(showsRemove(actions, false)).toBe(false);
  });

  it("keeps Remove on a completed nudge, whose offers collapse to the CTA", () => {
    // Without this, marking a nudge done would strand it in the completed
    // disclosure with no way to clear it.
    const actions = actionsFor(idFor("connect-sync"), NOW);

    expect(actions.map((a) => a.kind)).toEqual(["cta"]);
    expect(showsRemove(actions, true)).toBe(true);
  });

  it("keeps Remove on an ordinary reminder, which offers only put-offs", () => {
    expect(showsRemove(actionsFor("user-written"), false)).toBe(true);
  });

  it("withholds Remove from a coming row, which is not a row yet", () => {
    // Nothing to tombstone: the engine has not minted it, and the next
    // reconcile would undo whatever this pretended to do.
    expect(showsRemove(actionsFor("not-yet-minted"), false, false)).toBe(false);
  });

  // A prompt's permanent out is "don't ask again"; showing Remove beside it
  // would be two buttons for one tombstone, under a label that hides what it
  // does.
  it("withholds Remove from a prompt, which offers its own dismiss", () => {
    expect(
      showsRemove(
        reminderActionsOf(reminder("prompt"), { planTarget }, NOW),
        false,
      ),
    ).toBe(false);
  });

  it("keeps Remove on gift and duplicates rows", () => {
    const gift = reminderActionsOf(
      reminder("gift"),
      { giftTarget: { recipientType: "person", recipientId: "p1" } },
      NOW,
    );
    const dupes = reminderActionsOf(
      reminder("dupes"),
      { isDuplicatesNudge: true },
      NOW,
    );

    expect(showsRemove(gift, false)).toBe(true);
    expect(showsRemove(dupes, false)).toBe(true);
  });
});
