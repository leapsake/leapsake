/** Anything a list orders by identity. */
export interface Identified {
  id: string;
}

/**
 * A list in its natural order, held to the order it was last **pinned** in.
 *
 * The reminders list re-sorts on every write: completing a row moves it out of
 * the open bucket and down to the struck-through tail, so the thing you just
 * tapped leaps away from your finger and whatever was beneath it slides up under
 * it — the classic mis-tap. Pinning the order the user is looking at, and
 * re-applying it to the reloaded rows, lets the checkbox fill in place; the list
 * settles into its true order the next time it is loaded from scratch (see the
 * blur reset in `app/(tabs)/index.tsx`).
 *
 * Rows that aren't pinned — created by a peer's sync while the screen sits open,
 * or un-snoozed by the passing clock — appear beside the pinned row they
 * naturally follow, rather than being flushed to the end where a *new, open*
 * reminder would land below the completed ones. An arrival that sorts to the very
 * top gets a rank below every pinned row, so it stays at the top.
 *
 * Pinning an empty list is the un-pinned state: the natural order, untouched.
 */
export function stickyOrder<T extends Identified>(
  natural: readonly T[],
  pinned: readonly string[],
): T[] {
  if (pinned.length === 0) return [...natural];

  const rankOf = new Map(pinned.map((id, i) => [id, i]));
  // The rank of the most recent pinned row, which anything unpinned inherits so
  // it sorts immediately after that row. Before the first one, that's -1: above
  // everything pinned.
  let previous = -1;
  const ranked = natural.map((item, index) => {
    const pin = rankOf.get(item.id);
    if (pin !== undefined) previous = pin;
    return { item, rank: pin ?? previous, index };
  });

  // Ties are rows sharing an inherited rank; `index` keeps them in natural order,
  // and puts the pinned row itself ahead of the newcomers that trail it.
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map((r) => r.item);
}
