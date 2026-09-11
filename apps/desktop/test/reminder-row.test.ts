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

/** A reminder as far as `reminderActionsOf` reads one. */
const reminder = (
  id: string,
  snoozeCount = 0,
  completedAt: number | null = null,
) => ({
  id,
  completedAt,
  snoozeCount,
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

describe("rowAffordanceFor", () => {
  it("renders a nudge's three offers in order, each to its own desktop path", () => {
    // Every step accepts at least two "not now"s, so at a count of 1 this one
    // still offers snooze *and* has earned its dismiss — the full shape.
    const id = idFor("pick-self");
    const actions = reminderActionsOf(reminder(id, 1), {}, NOW);

    expect(affordancesFor(actions, id)).toEqual([
      { kind: "link", to: "/people?pick=self", label: "Pick yourself →" },
      {
        kind: "snooze",
        to: `/reminders/${id}/snooze`,
        until: expect.any(Number),
        label: "Not now",
      },
      {
        kind: "link",
        to: `/reminders/${id}/delete`,
        label: "Don’t ask again",
      },
    ]);
  });

  it("drops the snooze once the step has spent its repetitions, keeping dismiss", () => {
    // A count past any step's budget — deliberately dial-independent, since what
    // is under test is this client's mapping, not the number itself. The row can
    // no longer be put off but must still be endable.
    const id = idFor("connect-sync");
    const actions = reminderActionsOf(reminder(id, 99), {}, NOW);

    expect(affordancesFor(actions, id)).toEqual([
      { kind: "link", to: "/settings", label: "Sign in →" },
      {
        kind: "link",
        to: `/reminders/${id}/delete`,
        label: "Don’t ask again",
      },
    ]);
  });

  it("hands the snooze the exact date the action carried", () => {
    // The guard against a second derivation: whatever the policy chose is what
    // reaches the write, so the copy and the stored clock can never disagree.
    const id = idFor("import");
    const actions = reminderActionsOf(reminder(id), {}, NOW);
    const offered = actions.find((a) => a.kind === "snooze")!;
    const rendered = affordancesFor(actions, id).find(
      (a) => a.kind === "snooze",
    )!;

    expect(rendered.until).toBe(offered.until);
  });

  it("sends dismiss to the same route as Remove — one tombstone, one screen", () => {
    const id = idFor("connect-sync");
    const actions = reminderActionsOf(reminder(id, 1), {}, NOW);
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
    const done = reminderActionsOf(
      reminder("gift", 0, NOW),
      { giftTarget },
      NOW,
    );

    expect(affordancesFor(open, "gift")).toEqual([
      { kind: "link", to: "/people/p1", label: "See their gifts →" },
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
      {
        kind: "snooze",
        to: "/reminders/prompt/snooze",
        until: expect.any(Number),
        label: "Not now",
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
    expect(ctaLinkFor({ kind: "onboarding", route: "pick-self" })).toEqual({
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
  const actionsFor = (
    id: string,
    snoozeCount = 0,
    completedAt: number | null = null,
  ) => reminderActionsOf(reminder(id, snoozeCount, completedAt), {}, NOW);

  it("withholds Remove from an open nudge on its first encounter", () => {
    // The first encounter is a genuinely binary choice — do it, or not now.
    // Remove is the permanent option under a label that hides what it does.
    const id = idFor("connect-sync");
    const actions = actionsFor(id);

    expect(actions.map((a) => a.kind)).toEqual(["cta", "snooze"]);
    expect(showsRemove(actions, false)).toBe(false);
  });

  it("withholds Remove once the nudge offers its own dismiss", () => {
    // Otherwise the row shows two buttons for the one tombstone.
    const id = idFor("connect-sync");
    const actions = actionsFor(id, 1);

    expect(actions.map((a) => a.kind)).toContain("dismiss");
    expect(showsRemove(actions, false)).toBe(false);
  });

  it("keeps Remove on a completed nudge, whose offers collapse to the CTA", () => {
    // Without this, marking a nudge done would strand it in the completed
    // disclosure with no way to clear it.
    const id = idFor("connect-sync");
    const actions = actionsFor(id, 1, NOW);

    expect(actions.map((a) => a.kind)).toEqual(["cta"]);
    expect(showsRemove(actions, true)).toBe(true);
  });

  it("keeps Remove on an ordinary reminder, which offers nothing", () => {
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
        reminderActionsOf(reminder("prompt", 1), { planTarget }, NOW),
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
