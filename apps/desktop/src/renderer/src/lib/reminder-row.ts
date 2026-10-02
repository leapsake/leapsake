import type { OnboardingRoute } from "@leapsake/core";
import type { ReminderAction, ReminderRuleInput } from "@leapsake/schema";
import {
  type ReminderCta,
  type ReminderOfferLabel,
  type ReminderRowAction,
  reminderOfferLabelOf,
} from "@leapsake/view-models";

/** Each {@link OnboardingRoute} as this client's path. */
const ONBOARDING_PATH: Record<OnboardingRoute, string> = {
  // Desktop imports by drag-and-drop onto the people list.
  import: "/people",
  "create-account": "/settings",
  // ⚠️ Desktop has no notification settings, so this nudge stands for good.
  "enable-notifications": "/settings",
  "about-you": "/people?pick=self",
};

/** The words for each offer; a label that navigates ends in `→`. */
const LABELS: Record<Exclude<ReminderOfferLabel, "remindMe">, string> = {
  import: "Import →",
  createAccount: "Create your account →",
  enableNotifications: "Turn them on →",
  aboutYou: "Pick yourself →",
  duplicates: "Review duplicates →",
  choosePlan: "Choose →",
  seeGifts: "See their gifts →",
  recordGiving: "Record what you gave →",
  addContact: "Add a way to reach them →",
  addDate: "Add the date →",
  linkPartner: "Add who it’s with →",
  linkSpouse: "Who is your spouse? →",
  linkOwnPartner: "Who is your partner? →",
  justTheDay: "Just the day",
  dismiss: "Don’t ask again",
  stopAsking: "Don’t ask again…",
  giveInPerson: "Giving it in person",
};

/** A “Remind me in…” button's words for a day count, matching mobile's. */
function remindMeLabel(days: number): string {
  if (days === 1) return "Remind me tomorrow";
  if (days === 7) return "Remind me next week";
  return `Remind me in ${days} days`;
}

function labelOf(action: ReminderRowAction): string {
  if (action.kind === "snooze") return remindMeLabel(action.days);
  return LABELS[reminderOfferLabelOf(action) as keyof typeof LABELS];
}

/** Where a call to action leads on desktop. */
function ctaPathFor(cta: ReminderCta): string {
  switch (cta.kind) {
    case "onboarding":
      return ONBOARDING_PATH[cta.route];
    case "duplicates":
      return "/duplicates";
    case "plan":
      return `/milestones/${cta.milestoneId}/plan`;
    case "gift":
      return cta.action === "record-giving"
        ? `/gifts/new?recipient=${encodeURIComponent(`${cta.recipientType}:${cta.recipientId}`)}`
        : `${cta.recipientType === "pet" ? "/pets" : "/people"}/${cta.recipientId}`;
    // Their page: desktop has no route straight to an empty contact form.
    case "contact":
      return `/people/${cta.personId}`;
    case "partnership":
      return `/relationships/${cta.relationshipId}/milestones/new?kind=${cta.milestoneKind}`;
    // The rebind screen, which binds or creates the relationship.
    case "link-partner":
      return `/people/${cta.personId}/milestones/${cta.milestoneId}/rebind`;
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
      year: number;
      schedule: ReminderRuleInput[];
      label: string;
    }
  | {
      kind: "in-person";
      to: string;
      year: number;
      action: ReminderAction;
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
  const label = labelOf(action);
  switch (action.kind) {
    case "cta":
      return { kind: "link", to: ctaPathFor(action.cta), label };
    // The whole offer set, never just the tick: rows existing is what tells
    // "asked, and chose nothing" from "never asked".
    case "answer-plan":
      return {
        kind: "answer-plan",
        to: `/milestones/${action.milestoneId}/plan`,
        year: action.year,
        schedule: action.schedule,
        label,
      };
    case "snooze":
      return {
        kind: "snooze",
        to: `/reminders/${reminderId}/snooze`,
        days: action.days,
        label,
      };
    case "dismiss":
      return { kind: "link", to: `/reminders/${reminderId}/delete`, label };
    case "give-in-person":
      return {
        kind: "in-person",
        to: `/milestones/${action.milestoneId}/in-person`,
        year: action.year,
        action: action.action,
        label,
      };
    case "stop-asking":
      return {
        kind: "link",
        to: `/milestones/${action.milestoneId}/stop-asking?reminder=${reminderId}`,
        label,
      };
  }
}
