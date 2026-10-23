import type { EntityType } from "./relationship.js";
import type { Reminder } from "./reminder.js";

/**
 * What a search result opens: a person or pet, or a tag, holiday, gift idea or
 * reminder's own screen. Only a tag also lists the entities behind it.
 */
export type SearchResultType =
  | EntityType
  | "tag"
  | "holiday"
  | "gift_idea"
  | "reminder";

/** The state a reminder result shows beside its title. */
export type SearchReminderState = Pick<
  Reminder,
  "completedAt" | "snoozedUntil" | "dueDate"
>;

/**
 * One search result. An entity matching through several facets is one hit with
 * its `reasons` merged.
 */
export interface SearchHit {
  /** What the result opens. */
  entityType: SearchResultType;
  entityId: string;
  /** The display name of the person, pet, or other result. */
  title: string;
  /** Why it matched, per facet, for the "matched on …" subtitle. */
  reasons: { facet: string; matchedText: string }[];
  /** Set on a reminder result only. */
  reminder?: SearchReminderState;
}
