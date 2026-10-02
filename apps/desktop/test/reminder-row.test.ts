import { ONBOARDING_REMINDERS } from "@leapsake/core";
import {
  type ReminderRowAction,
  reminderActionsOf,
} from "@leapsake/view-models";
import { describe, expect, it } from "vitest";
import type { ReminderCta } from "@leapsake/view-models";
import { rowAffordanceFor } from "../src/renderer/src/lib/reminder-row.js";

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
  occurrenceYear: 2026,
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
    const id = idFor("create-account");
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
        year: 2026,
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
        to: "/milestones/m1/stop-asking?reminder=prompt",
        label: "Don’t ask again…",
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

describe("a CTA's link", () => {
  const linkFor = (cta: ReminderCta) =>
    rowAffordanceFor({ kind: "cta", cta }, "r1");

  it("maps every onboarding route to a path", () => {
    for (const { route } of ONBOARDING_REMINDERS) {
      const link = linkFor({ kind: "onboarding", route });
      expect(link.kind === "link" && link.to.startsWith("/")).toBe(true);
      expect(link.label).not.toBe("");
    }
  });

  it("sends a pet's gifts to the pets tree, not people", () => {
    expect(
      linkFor({
        kind: "gift",
        action: "see-gifts",
        recipientType: "pet",
        recipientId: "x1",
      }),
    ).toEqual({ kind: "link", to: "/pets/x1", label: "See their gifts →" });
  });

  // Desktop has no route straight into an empty contact form, unlike mobile.
  it("sends the collect prompt to the person's page", () => {
    expect(linkFor({ kind: "contact", personId: "p1" })).toEqual({
      kind: "link",
      to: "/people/p1",
      label: "Add a way to reach them →",
    });
  });

  it("asks for your partner, not a spouse, on your own first date", () => {
    expect(
      linkFor({
        kind: "link-partner",
        milestoneId: "m1",
        milestoneKind: "first-date",
        personId: "p1",
        isSelf: true,
      }),
    ).toEqual({
      kind: "link",
      to: "/people/p1/milestones/m1/rebind",
      label: "Who is your partner? →",
    });
  });
});
