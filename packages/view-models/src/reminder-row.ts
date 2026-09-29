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
  | "dismiss";

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
 * What a row offers besides its actions. An open nudge or `🗓 plan` prompt shows
 * no Remove, because its own "don't ask again" is the same tombstone.
 */
export function reminderRowOf(
  actions: readonly ReminderRowAction[],
  done: boolean,
): { showsRemove: boolean; removal: ReminderRemoval } {
  const nudge = actions.some(
    (a) =>
      a.kind === "cta" &&
      (a.cta.kind === "onboarding" || a.cta.kind === "plan"),
  );
  return { showsRemove: done || !nudge, removal: nudge ? "dismiss" : "remove" };
}
