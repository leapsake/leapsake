import type { OnboardingRoute } from "@leapsake/core";
import type { ReminderRuleInput } from "@leapsake/schema";
import type { ReminderCta, ReminderRowAction } from "@leapsake/view-models";

/** Each onboarding nudge's abstract {@link OnboardingRoute} as this client's own
 *  router path plus its link copy. */
const ONBOARDING_CTA: Record<OnboardingRoute, { path: string; label: string }> =
  {
    "add-person": { path: "/people/new", label: "Add person →" },
    // The two custody routes land on the same screen today — an accountless
    // Settings renders `CreateAccount` above `SyncSetup`, so each nudge's target
    // is already on it — but they stay two routes, not one. The labels are the
    // fork the user reads (*sign in* vs *create*), and splitting the destination
    // is then a table edit rather than a plumbing change, which is what the
    // Settings decomposition in v0-2 will want.
    "connect-sync": { path: "/settings", label: "Sign in →" },
    "create-account": { path: "/settings", label: "Create your account →" },
    // ⚠️ **This destination does not exist yet.** Desktop has no notification
    // surface at all — no policy screen, no scheduler — so the step's condition
    // (`notification_settings` holding no rows) can never be satisfied from
    // here, and the nudge would stand for good pointing at a Settings screen
    // with nothing on it to answer. That is the same "front door onto a shut
    // room" the `sync-devices` step's `multiDevice` gate exists to avoid.
    //
    // It is left pointing at Settings deliberately rather than solved: v0.1 is
    // iOS alone and desktop ships after the transfer (`plans/shipping.md` →
    // Part 2), so this is a dev-build wart with a known fix — gate the step the
    // way `sync-devices` is gated, or give desktop notifications — and no user
    // between here and there.
    "enable-notifications": { path: "/settings", label: "Turn them on →" },
    "pick-self": { path: "/people?pick=self", label: "Pick yourself →" },
  };

/**
 * The copy for the two actions that aren't a call to action — deliberately
 * plain. The offered `snooze` carries the date it runs to, so “Not now (ask me
 * in 3 days)” is available for free; it is not spent here because saying a date
 * in words means either splicing a pre-formatted English fragment into a
 * sentence or hand-rolling a plural rule in a screen that has no message
 * catalog. Cheap to spend once these screens move into `@leapsake/ui`.
 */
const ACTION_LABELS = {
  // The prompt's one-tap answer, and the reason it is a button on the row rather
  // than a control on a form. It is the answer most people give most of the time
  // — *nothing special, just remind me on the day* — and the whole trade the
  // prompt makes rests on that answer being cheaper than ignoring a row was.
  answerPlan: "Just the day",
  snooze: "Not now",
  dismiss: "Don’t ask again",
} as const;

/**
 * A reminder's CTA decision (see {@link reminderCtaOf}, which holds the *why* of
 * each) rendered in this client's terms: a react-router path plus its copy. A
 * gift CTA's target flips once the reminder is done — from the recipient's own
 * page to the capture form fixed to them, to log what was actually given.
 */
export function ctaLinkFor(cta: ReminderCta): { path: string; label: string } {
  switch (cta.kind) {
    case "onboarding":
      return ONBOARDING_CTA[cta.route];
    case "duplicates":
      return { path: "/duplicates", label: "Review duplicates →" };
    // The full offer set, on a screen with room for it. The *common* answer
    // never comes here — it is the one-tap `answer-plan` affordance on the row —
    // so this is for the user who wants a card as well.
    case "plan":
      return { path: `/milestones/${cta.milestoneId}/plan`, label: "Choose →" };
    case "gift": {
      const party = `${cta.recipientType}:${cta.recipientId}`;
      return cta.action === "record-giving"
        ? {
            path: `/gifts/new?recipient=${encodeURIComponent(party)}`,
            label: "Record what you gave →",
          }
        : {
            path: `${cta.recipientType === "pet" ? "/pets" : "/people"}/${cta.recipientId}`,
            label: "See their gifts →",
          };
    }
    // A wish for somebody with no way to reach them. Their page rather than a
    // form: desktop adds contact methods from the person's own Contact section,
    // and unlike mobile it has no route that opens straight into an empty one.
    // Worded as an offer, not a missing field — the reminder is completable
    // without it.
    case "contact":
      return {
        path: `/people/${cta.personId}`,
        label: "Add a way to reach them →",
      };
    // The milestone form for this relationship, already on the kind the question
    // asked about. Unlike `contact` above there is no ambiguity about where to
    // send someone: the answer is one date on one form.
    case "partnership":
      return {
        path: `/relationships/${cta.relationshipId}/milestones/new?kind=${cta.milestoneKind}`,
        label: "Add the date →",
      };
    // A wedding whose other party was left unknown. Straight to the rebind
    // screen, which is the flow written for exactly this and which both binds an
    // existing relationship and creates a missing one. Mobile has no rebind
    // screen and so goes somewhere else — see its `ctaOffer`.
    case "link-partner":
      return {
        path: `/people/${cta.personId}/milestones/${cta.milestoneId}/rebind`,
        // Named on your own, generic on someone else's: at that moment the app
        // knows exactly what it is short of, and asking plainly is shorter than
        // describing it.
        label: cta.isSelf ? "Who is your spouse? →" : "Add who it's with →",
      };
  }
}

/**
 * One offered action as this client renders it. A `link` is a plain `<Link>`; a
 * `snooze` is a fetcher form posting to `to`, because the row has to *disappear*
 * once put off and a fetcher post revalidates the list's loader in place (the
 * same mechanism the Done toggle already relies on).
 */
export type RowAffordance =
  | { kind: "link"; to: string; label: string }
  | { kind: "snooze"; to: string; until: number; label: string }
  | {
      kind: "answer-plan";
      to: string;
      schedule: ReminderRuleInput[];
      label: string;
    };

/**
 * What one {@link ReminderRowAction} looks like on desktop — the path, the copy
 * and how it is submitted — so the row component renders and decides nothing.
 *
 * A snooze's `until` is passed through **verbatim**. It is the date
 * `snoozePolicyOf` chose and the offered action carried; recomputing it here
 * would be a second evaluation that disagrees with the first whenever a dial
 * changes.
 *
 * Dismiss deliberately shares the remove route. Deleting a system reminder has
 * always been the permanent “never ask again” — `reconcile` doesn't resurrect a
 * tombstoned id — so this is the existing mechanism finally getting an honest
 * label, not a new one. The confirm screen it lands on words itself for whichever
 * kind of row it was handed.
 */
export function rowAffordanceFor(
  action: ReminderRowAction,
  reminderId: string,
): RowAffordance {
  switch (action.kind) {
    case "cta": {
      const { path, label } = ctaLinkFor(action.cta);
      return { kind: "link", to: path, label };
    }
    // A post like `snooze`, for the same reason: the row has to leave the list
    // once it is answered, and a fetcher submission revalidates the loader in
    // place. It carries the **whole** offer set the view-model built, never just
    // the tick — rows existing is what makes "asked, and chose nothing"
    // distinguishable from "never asked".
    case "answer-plan":
      return {
        kind: "answer-plan",
        to: `/milestones/${action.milestoneId}/plan`,
        schedule: action.schedule,
        label: ACTION_LABELS.answerPlan,
      };
    case "snooze":
      return {
        kind: "snooze",
        to: `/reminders/${reminderId}/snooze`,
        until: action.until,
        label: ACTION_LABELS.snooze,
      };
    case "dismiss":
      return {
        kind: "link",
        to: `/reminders/${reminderId}/delete`,
        label: ACTION_LABELS.dismiss,
      };
  }
}

/**
 * Whether the row shows its own `Remove` link — **no**, while it is an open
 * onboarding nudge.
 *
 * `reminderActionsOf` withholds `dismiss` from ordinary reminders precisely
 * because `Remove` already gives them that affordance, and this is the mirror of
 * that: a nudge's permanent out is “don't ask again”, so showing both would be
 * two buttons for one tombstone. It also delivers the rule that a *first*
 * encounter is a genuinely binary choice — do it, or not now — since the action
 * list withholds dismiss until the second, and leaving `Remove` there would hand
 * back the permanent option under a label that hides what it does.
 *
 * A **completed** nudge keeps it. Its action list is CTA-only, so without this a
 * user who marked a nudge done would have no way to clear it from the completed
 * disclosure; and a finished row is an ordinary row again.
 *
 * An **unmaterialized** row never shows it. A *coming* row is a preview of
 * something the engine has not minted yet, so there is nothing to tombstone —
 * and offering to remove it would promise a permanence the engine's own walk
 * would undo on the next reconcile.
 */
export function showsRemove(
  actions: readonly ReminderRowAction[],
  done: boolean,
  materialized = true,
): boolean {
  if (!materialized) return false;
  // A `🗓 plan` prompt counts as a nudge here for the same reason an onboarding
  // step does: its permanent out is "don't ask again", and showing `Remove`
  // beside it would be two buttons for one tombstone under a label that hides
  // what it does.
  const isNudge = actions.some(
    (a) =>
      a.kind === "cta" &&
      (a.cta.kind === "onboarding" || a.cta.kind === "plan"),
  );
  return done || !isNudge;
}
