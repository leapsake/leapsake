/** What the Holidays section partitions on: the answer, and whether hidden. */
export interface BearerHolidayFacts {
  observes: boolean;
  hidden: boolean;
}

/** What a bearer observes, hidden ones marked, and what it can be offered,
 *  never a hidden holiday, which would do nothing. */
export function splitBearerHolidays<H extends BearerHolidayFacts>(
  holidays: readonly H[],
): { observed: H[]; addable: H[] } {
  return {
    observed: holidays.filter((h) => h.observes),
    addable: holidays.filter((h) => !h.observes && !h.hidden),
  };
}
