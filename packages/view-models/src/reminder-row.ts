import type { OnboardingRoute } from "@leapsake/reminders";
import type { ReminderRowAction } from "./reminders.js";

/**
 * Which words an offered action wears, as a key: each client owns the words
 * themselves, and the path a navigating offer leads to.
 */
export type ReminderOfferLabel =
  | "import"
  | "createAccount"
  | "enableNotifications"
  | "aboutYou"
  | "duplicates"
  | "choosePlan"
  | "seeGifts"
  | "recordGiving"
  | "addContact"
  | "addDate"
  | "linkPartner"
  | "linkSpouse"
  | "linkOwnPartner"
  | "justTheDay"
  | "remindMe"
  | "dismiss"
  | "stopAsking"
  | "giveInPerson";

const ONBOARDING_LABEL = {
  import: "import",
  "create-account": "createAccount",
  "enable-notifications": "enableNotifications",
  "about-you": "aboutYou",
} as const satisfies Record<OnboardingRoute, ReminderOfferLabel>;

/** The label key for one offered action; `remindMe` takes its `days`. */
export function reminderOfferLabelOf(
  action: ReminderRowAction,
): ReminderOfferLabel {
  if (action.kind === "answer-plan") return "justTheDay";
  if (action.kind === "snooze") return "remindMe";
  if (action.kind === "dismiss") return "dismiss";
  if (action.kind === "stop-asking") return "stopAsking";
  if (action.kind === "give-in-person") return "giveInPerson";
  const { cta } = action;
  switch (cta.kind) {
    case "onboarding":
      return ONBOARDING_LABEL[cta.route];
    case "duplicates":
      return "duplicates";
    case "plan":
      return "choosePlan";
    case "gift":
      return cta.action === "record-giving" ? "recordGiving" : "seeGifts";
    case "contact":
      return "addContact";
    case "partnership":
      return "addDate";
    case "link-partner":
      if (!cta.isSelf) return "linkPartner";
      return cta.milestoneKind === "wedding" ? "linkSpouse" : "linkOwnPartner";
  }
}

/** How a row's removal is worded; a nudge's tombstone is permanent. */
export type ReminderRemoval = "dismiss" | "remove";

/**
 * What a row offers besides its actions. Only an errand completes; a nudge or
 * prompt retires itself, and when open shows no Remove beside its own dismiss.
 */
export function reminderRowOf(
  actions: readonly ReminderRowAction[],
  done: boolean,
): { completable: boolean; showsRemove: boolean; removal: ReminderRemoval } {
  const ctaKinds = actions.flatMap((a) =>
    a.kind === "cta" ? [a.cta.kind] : [],
  );
  const nudge = ctaKinds.includes("onboarding") || ctaKinds.includes("plan");
  return {
    completable: !nudge && !ctaKinds.includes("duplicates"),
    showsRemove: done || !nudge,
    removal: nudge ? "dismiss" : "remove",
  };
}
