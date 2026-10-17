// What a notification's wording is written from. The words themselves are the
// caller's, so this package holds no user-visible text.

/** When in its day a notification fires, as its wording knows it. */
export type PartOfDay = "morning" | "day" | "evening";

/** Everything a digest's wording may depend on. */
export interface DigestSituation {
  /** Whether an earlier delivery time comes before this one the same day. */
  followUp: boolean;
  /** Whether it carries a note remembering someone who has died, so it is
   *  worded quietly. */
  remembering: boolean;
  partOfDay: PartOfDay;
  /** The reminders it carries, labelled; at least one. */
  labels: readonly string[];
  /** A non-negative integer, fixed per digest, for choosing among phrasings. */
  variant: number;
}

/** The text of one notification. */
export interface NotificationText {
  title: string;
  body: string;
}

/** The wording every planned notification is written with. */
export interface NotificationCopy {
  digest(situation: DigestSituation): NotificationText;
  /** The one label a holiday occurrence's wishes share: never a count. */
  wishGroup(greeting: string, icon?: string): string;
  /** The notice that the schedule is about to lapse. */
  runningOut: NotificationText;
}

/** Morning is 04:00 until 10:00, evening 17:00 until 04:00. */
export function partOfDayOf(minute: number): PartOfDay {
  if (minute >= 4 * 60 && minute < 10 * 60) return "morning";
  if (minute >= 17 * 60 || minute < 4 * 60) return "evening";
  return "day";
}

/** A stable hash of a digest's id (djb2), so a re-plan picks the same words. */
export function variantOf(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++)
    hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  return hash;
}
