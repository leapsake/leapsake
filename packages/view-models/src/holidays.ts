/**
 * What the Holidays section partitions on: the bearer's effective answer and
 * whether the user has suppressed the holiday entirely. Core's
 * `BearerHolidayCandidate` satisfies it structurally.
 */
export interface BearerHolidayFacts {
  observes: boolean;
  hidden: boolean;
}

/**
 * The two lists the Holidays section on a Person or Pet screen shows: the
 * holidays this bearer **observes**, and the ones it can be offered.
 *
 * Hidden holidays are excluded from *suggestions* because offering one would be
 * offering a no-op — a hidden holiday generates no reminders, so adding an
 * observance to it would appear to do nothing. The browse list deliberately
 * differs: that is where a user goes to unhide one, so filtering them out there
 * would strand them. A hidden holiday already observed still shows in
 * {@link observed}, marked, or the state would be unexplainable.
 */
export function splitBearerHolidays<H extends BearerHolidayFacts>(
  holidays: readonly H[],
): { observed: H[]; addable: H[] } {
  return {
    observed: holidays.filter((h) => h.observes),
    addable: holidays.filter((h) => !h.observes && !h.hidden),
  };
}
