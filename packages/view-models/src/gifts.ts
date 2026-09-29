/** What every gift list sorts on; `givenAt` is a stamp, read only as set. */
export interface GiftGivenState {
  givenAt: number | null;
}

/** Whether this link has been ticked. The one question `givenAt` answers. */
export const isGiven = (row: GiftGivenState): boolean => row.givenAt !== null;

/** Outstanding gifts first, given last, each half by the caller's label;
 *  nothing is dropped. */
export function sortGiftsGivenLast<T extends GiftGivenState>(
  rows: readonly T[],
  label: (row: T) => string,
): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(isGiven(a)) - Number(isGiven(b)) ||
      label(a).localeCompare(label(b)),
  );
}

/** Ideas everyone has been given sink, otherwise in the caller's order; an
 *  idea with no recipients is outstanding. */
export function sortIdeasGivenLast<
  T extends { recipients: readonly GiftGivenState[] },
>(rows: readonly T[]): T[] {
  const done = (row: T) =>
    row.recipients.length > 0 && row.recipients.every(isGiven);
  return [...rows].sort((a, b) => Number(done(a)) - Number(done(b)));
}
