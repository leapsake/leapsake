/**
 * `@leapsake/view-models` — the **headless derivations** every client shows the
 * same way: grouping, partitioning and ordering over data that has already been
 * loaded. Pure functions, no repo access, no DOM, no React — which is what lets
 * the Electron renderer, the Expo app and (later) the web app share them instead
 * of each maintaining its own copy of the same sort.
 *
 * The boundary against `@leapsake/core`: **needs repo or driver access ⇒ `core`**
 * (its `views.ts` keeps those view-models); **pure derivation over already-loaded
 * data ⇒ here**. Deliberately generic over the caller's row types rather than
 * importing core's — each function constrains only the fields it reads, so core's
 * types stay assignable without this package depending on the data layer.
 */
export { groupGiftsByIdea, sortIdeasGivenLast } from "./gifts.js";
export type { GiftIdeaRef, IdeaGroup } from "./gifts.js";
export { splitBearerHolidays } from "./holidays.js";
export type { BearerHolidayFacts } from "./holidays.js";
export {
  partitionReminders,
  reminderActionsOf,
  reminderCtaOf,
} from "./reminders.js";
export type {
  GiftReminderSubject,
  ReminderCta,
  ReminderRowAction,
  ReminderStanding,
} from "./reminders.js";
