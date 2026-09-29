import type { OnboardingRoute } from "@leapsake/core";
import type { ReminderRuleInput } from "@leapsake/schema";
import {
  type ReminderCta,
  type ReminderOfferLabel,
  type ReminderRemoval,
  type ReminderRowAction,
  reminderOfferLabelOf,
} from "@leapsake/view-models";

/** Each onboarding nudge's {@link OnboardingRoute} as this app's path. */
const ONBOARDING_PATH: Record<OnboardingRoute, string> = {
  import: "/import",
  "create-account": "/settings",
  // Choosing a policy there is what fires the OS permission request.
  "enable-notifications": "/notifications",
  "about-you": "/about-you",
};

/** The words for each offer; a label that navigates ends in `›`. */
const LABELS: Record<Exclude<ReminderOfferLabel, "remindMe">, string> = {
  import: "Import ›",
  createAccount: "Create your account ›",
  enableNotifications: "Turn them on ›",
  aboutYou: "Get started ›",
  duplicates: "Review ›",
  // Never drawn: the detail screen carries the prompt's form.
  choosePlan: "Choose below",
  seeGifts: "See their gifts ›",
  recordGiving: "Record what you gave ›",
  addContact: "Add a way to reach them ›",
  addDate: "Add the date ›",
  linkPartner: "Add who it’s with ›",
  linkSpouse: "Who is your spouse? ›",
  linkOwnPartner: "Who is your partner? ›",
  justTheDay: "Just the day",
  dismiss: "Don’t ask again",
};

/** The words on a “Remind me in…” button, for any whole number of days. */
function remindMeLabel(days: number): string {
  if (days === 1) return "Remind me tomorrow";
  if (days === 7) return "Remind me next week";
  return `Remind me in ${days} days`;
}

function labelOf(action: ReminderRowAction): string {
  if (action.kind === "snooze") return remindMeLabel(action.days);
  return LABELS[reminderOfferLabelOf(action) as keyof typeof LABELS];
}

/**
 * One offered action as this client renders it. Snooze and dismiss call core in
 * place, so neither needs a destination or the reminder's id.
 */
export type RowOffer =
  | { kind: "navigate"; path: string; label: string }
  | { kind: "answer-prompt"; label: string }
  | {
      kind: "answer-plan";
      milestoneId: string;
      schedule: ReminderRuleInput[];
      label: string;
    }
  | { kind: "snooze"; days: number; label: string }
  | { kind: "dismiss"; label: string };

/** Where a call to action leads; null for a prompt, answered in place. */
function ctaPathFor(cta: ReminderCta): string | null {
  switch (cta.kind) {
    case "onboarding":
      return ONBOARDING_PATH[cta.route];
    case "duplicates":
      return "/duplicates";
    case "plan":
      return null;
    // `given=1` opens the capture form ticked.
    case "gift":
      return cta.action === "record-giving"
        ? `/gifts/new?recipient=${encodeURIComponent(`${cta.recipientType}:${cta.recipientId}`)}&given=1`
        : `${cta.recipientType === "pet" ? "/pets" : "/people"}/${cta.recipientId}`;
    // Straight to the form: their page would open on an empty Contact section.
    case "contact":
      return `/people/${cta.personId}/contacts/new`;
    case "partnership":
      return `/relationships/${cta.relationshipId}/milestones/new?kind=${cta.milestoneKind}`;
    case "link-partner":
      return `/people/${cta.personId}/milestones/${cta.milestoneId}/partner?kind=${cta.milestoneKind}`;
  }
}

/**
 * One {@link ReminderRowAction} as mobile draws it, so the screen decides
 * nothing. A snooze passes its day count through verbatim.
 */
export function offerFor(action: ReminderRowAction): RowOffer {
  const label = labelOf(action);
  switch (action.kind) {
    case "cta": {
      const path = ctaPathFor(action.cta);
      return path === null
        ? { kind: "answer-prompt", label }
        : { kind: "navigate", path, label };
    }
    case "answer-plan":
      return {
        kind: "answer-plan",
        milestoneId: action.milestoneId,
        schedule: action.schedule,
        label,
      };
    case "snooze":
      return { kind: "snooze", days: action.days, label };
    case "dismiss":
      return { kind: "dismiss", label };
  }
}

/**
 * Whether the detail screen's inline prompt form already answers this offer, so
 * it must not also draw as a button.
 */
export function isAnsweredInline(action: ReminderRowAction): boolean {
  return (
    action.kind === "answer-plan" ||
    (action.kind === "cta" &&
      (action.cta.kind === "plan" || action.cta.kind === "link-partner"))
  );
}

/** What the removal confirmation says; `message` takes the reminder's label. */
export interface RemovalCopy {
  title: string;
  message: (label: string) => string;
  confirm: string;
}

/** Each {@link ReminderRemoval}'s confirmation; a nudge's is permanent. */
export const REMOVAL_COPY: Record<ReminderRemoval, RemovalCopy> = {
  remove: {
    title: "Delete reminder",
    message: (label) => `Delete “${label}”?`,
    confirm: "Delete",
  },
  dismiss: {
    title: "Stop asking about this?",
    message: (label) => `Leapsake won’t ask about “${label}” again.`,
    confirm: "Don’t ask again",
  },
};
