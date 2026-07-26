/**
 * The two fields every gift row — a suggestion or a giving — carries about the
 * idea it points at. Both clients' row types (core's `GiftSuggestionForRecipient`
 * / `GiftForRecipient`) satisfy it structurally, and the grouping is generic over
 * the rest of the row so each client keeps its own type on the way out.
 */
export interface GiftIdeaRef {
  giftIdeaId: string;
  ideaTitle: string;
  ideaUrl: string | null;
}

/** One gift idea's standing for a recipient: its suggestion(s), if any, and its
 *  giving(s), if any — the two tables unioned by idea for a single list. */
export interface IdeaGroup<S extends GiftIdeaRef, G extends GiftIdeaRef> {
  ideaId: string;
  title: string;
  url: string | null;
  suggestions: S[];
  gifts: G[];
}

/**
 * The list behind the Gifts section on a Person or Pet screen: one entry per
 * idea, combining **suggestions** (candidates) with **givings** (dated events).
 * A giving points at the idea, never at the suggestion, so "✓ given" is a fact
 * read alongside the candidate rather than a state the suggestion moves through.
 *
 * Candidates not yet given lead and given ideas sink — the shopping list stays on
 * top — alphabetically within each half. Nothing is dropped: an idea given once
 * is still a fine idea to give again.
 */
export function groupGiftsByIdea<S extends GiftIdeaRef, G extends GiftIdeaRef>(
  suggestions: readonly S[],
  gifts: readonly G[],
): IdeaGroup<S, G>[] {
  const groups = new Map<string, IdeaGroup<S, G>>();
  const groupFor = (row: GiftIdeaRef) => {
    const existing = groups.get(row.giftIdeaId);
    if (existing) return existing;
    const created: IdeaGroup<S, G> = {
      ideaId: row.giftIdeaId,
      title: row.ideaTitle,
      url: row.ideaUrl,
      suggestions: [],
      gifts: [],
    };
    groups.set(row.giftIdeaId, created);
    return created;
  };
  for (const s of suggestions) groupFor(s).suggestions.push(s);
  for (const g of gifts) groupFor(g).gifts.push(g);

  return [...groups.values()].sort((a, b) => {
    const aGiven = a.gifts.length > 0 ? 1 : 0;
    const bGiven = b.gifts.length > 0 ? 1 : 0;
    return aGiven - bGiven || a.title.localeCompare(b.title);
  });
}

/**
 * The Gifts screen's order (the whole graph keyed by idea): ideas already given
 * sink to the bottom, keeping the shopping list on top — the same posture
 * {@link groupGiftsByIdea} takes on a Person or Pet screen. Within each half the
 * caller's incoming order stands (the repo's newest-first), so this sorts on the
 * one bit and nothing else, and never hides a row.
 */
export function sortIdeasGivenLast<T extends { gifts: readonly unknown[] }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => (a.gifts.length > 0 ? 1 : 0) - (b.gifts.length > 0 ? 1 : 0),
  );
}
