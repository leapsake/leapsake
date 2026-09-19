import type { OnboardingRoute } from "@leapsake/core";
import type { ReminderRuleInput } from "@leapsake/schema";
import type { ReminderCta, ReminderRowAction } from "@leapsake/view-models";

/** Each {@link OnboardingRoute} as this client's path and link copy. */
const ONBOARDING_CTA: Record<OnboardingRoute, { path: string; label: string }> =
  {
    // Desktop imports by drag-and-drop, with no screen to link to, so this
    // lands on the list a vCard can be dropped onto.
    import: { path: "/people", label: "Import →" },
    "create-account": { path: "/settings", label: "Create your account →" },
    // ⚠️ Desktop has no notification settings, so this nudge can never be
    // satisfied here and stands for good.
    "enable-notifications": { path: "/settings", label: "Turn them on →" },
    // The people list's pick mode; mobile has its own screen for this.
    "about-you": { path: "/people?pick=self", label: "Pick yourself →" },
  };

/** Copy for the non-CTA actions; snooze uses {@link remindMeLabel}. */
const ACTION_LABELS = {
  // The prompt's one-tap answer: the one most people give, so it must cost
  // less than ignoring the row.
  answerPlan: "Just the day",
  dismiss: "Don’t ask again",
} as const;

/** A “Remind me in…” button's words for a day count, matching mobile's. */
function remindMeLabel(days: number): string {
  if (days === 1) return "Remind me tomorrow";
  if (days === 7) return "Remind me next week";
  return `Remind me in ${days} days`;
}

/**
 * A {@link reminderCtaOf} decision as a path and its copy. A done gift reminder
 * links to logging what was given rather than the recipient's page.
 */
export function ctaLinkFor(cta: ReminderCta): { path: string; label: string } {
  switch (cta.kind) {
    case "onboarding":
      return ONBOARDING_CTA[cta.route];
    case "duplicates":
      return { path: "/duplicates", label: "Review duplicates →" };
    // The full offer set; the common answer is the row's one-tap button.
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
    // Their page: desktop adds contact methods there, with no route straight
    // to an empty form. Worded as an offer, since the reminder is completable.
    case "contact":
      return {
        path: `/people/${cta.personId}`,
        label: "Add a way to reach them →",
      };
    // The milestone form, already on the kind the question asked about.
    case "partnership":
      return {
        path: `/relationships/${cta.relationshipId}/milestones/new?kind=${cta.milestoneKind}`,
        label: "Add the date →",
      };
    // A wedding whose other party is unknown goes to the rebind screen, which
    // binds or creates the relationship. Mobile has no such screen.
    case "link-partner":
      return {
        path: `/people/${cta.personId}/milestones/${cta.milestoneId}/rebind`,
        // Named on your own, generic on someone else's.
        label: cta.isSelf ? "Who is your spouse? →" : "Add who it's with →",
      };
  }
}

/**
 * A `link` is a plain `<Link>`; the others are fetcher posts, which revalidate
 * the list in place so the row can disappear.
 */
export type RowAffordance =
  | { kind: "link"; to: string; label: string }
  | { kind: "snooze"; to: string; days: number; label: string }
  | {
      kind: "answer-plan";
      to: string;
      schedule: ReminderRuleInput[];
      label: string;
    };

/**
 * A {@link ReminderRowAction}'s path, copy and submission, so the row decides
 * nothing. Dismiss is the remove route: a tombstone is never resurrected.
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
    // Carries the whole offer set, never just the tick: rows existing is what
    // tells "asked, and chose nothing" from "never asked".
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
        days: action.days,
        label: remindMeLabel(action.days),
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
 * No `Remove` beside an open nudge's "don't ask again", which is the same
 * tombstone, nor on an unminted preview; a done row is ordinary again.
 */
export function showsRemove(
  actions: readonly ReminderRowAction[],
  done: boolean,
  materialized = true,
): boolean {
  if (!materialized) return false;
  // A `🗓 plan` prompt's permanent out is "don't ask again" too.
  const isNudge = actions.some(
    (a) =>
      a.kind === "cta" &&
      (a.cta.kind === "onboarding" || a.cta.kind === "plan"),
  );
  return done || !isNudge;
}
