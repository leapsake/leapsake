/**
 * What every gift list sorts on: whether it has been given. `givenAt` is a stamp
 * recording when the box was ticked, never a date anyone typed, so the only thing
 * read off it here is whether it is set.
 */
export interface GiftGivenState {
  givenAt: number | null;
}

/** Whether this link has been ticked. The one question `givenAt` answers. */
export const isGiven = (row: GiftGivenState): boolean => row.givenAt !== null;

/**
 * Gift rows in the order every list wants them: **outstanding first, given last**
 * — the shopping list stays on top — alphabetically within each half by the
 * caller's chosen label.
 *
 * Nothing is dropped: an idea given once is still a fine idea to give again.
 *
 * This used to be `groupGiftsByIdea`, which unioned `gift_suggestions` and
 * `gifts` into one entry per idea, because "✓ given" lived in a second table and
 * a recipient could hold both a candidate row and N giving rows for the same
 * idea. One table with a `given_at` column makes that a sort.
 */
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

/**
 * The Gifts screen's order (the whole catalog, keyed by idea): an idea everybody
 * on it has already been given sinks to the bottom, keeping the shopping list on
 * top. Within each half the caller's incoming order stands (the repo's
 * newest-first), so this sorts on the one bit and nothing else, and never hides a
 * row.
 *
 * An idea with **no** recipients counts as outstanding — it is a thing you might
 * still give someone, which is the whole reason a recipientless idea can exist.
 */
export function sortIdeasGivenLast<
  T extends { recipients: readonly GiftGivenState[] },
>(rows: readonly T[]): T[] {
  const done = (row: T) =>
    row.recipients.length > 0 && row.recipients.every(isGiven);
  return [...rows].sort((a, b) => Number(done(a)) - Number(done(b)));
}
