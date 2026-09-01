import type { SearchHit, SearchResultType } from "@leapsake/schema";

/**
 * One tile on Search's browse grid — and, when it is the active filter, one
 * answer to "what am I looking at?".
 *
 * A category is **not** a `SearchResultType`. People and pets are two record
 * types and one idea: a user looking for "the people I know" is not making a
 * distinction the schema makes, and the app's own list screen has always shown
 * them together as "People & Pets". So a category owns a *set* of hit types.
 */
export interface SearchCategory {
  /**
   * What `?type=` carries. Stable — it is in URLs, and it names the header links
   * a catalog carries (`search-here-<key>`), which the E2E flows tap by id.
   */
  key: string;
  label: string;
  glyph: string;
  /** The hit types this category admits. */
  types: readonly SearchResultType[];
  /** The full list behind the tile, for browsing rather than searching. */
  browseHref: string;
}

/**
 * The browse grid, and the app's whole answer to "what kinds of thing are in
 * here?".
 *
 * One table, two readers: the tiles on Search's empty state, and the filter that
 * narrows its results. Adding a kind of record should be one entry here rather
 * than two edits that can disagree.
 *
 * It had a third reader — a `createHref` that told the old New tab what to make
 * on a filtered search. Creating is a header action on the catalog itself now
 * (`app/(tabs)/_layout.tsx`), which is a screen rather than a category, so the
 * field went with the tab. Nothing here answers "what does ➕ make?" any more,
 * and nothing here should: two of these four hold nothing a user authors.
 *
 * People leads because it is what the app is mostly about; the rest follow in
 * the order they were built. It keeps its tile even though it now has a tab of
 * its own — the grid is this app's answer to "what kinds of thing are in here?",
 * and an answer missing the biggest one to avoid repeating a button is a worse
 * answer.
 */
export const SEARCH_CATEGORIES: readonly SearchCategory[] = [
  {
    key: "people",
    label: "People & Pets",
    glyph: "👥",
    types: ["person", "pet"],
    browseHref: "/people",
  },
  {
    key: "gifts",
    label: "Gift ideas",
    glyph: "🎁",
    types: ["gift_idea"],
    browseHref: "/gifts",
  },
  {
    key: "holidays",
    label: "Holidays",
    glyph: "🎉",
    types: ["holiday"],
    browseHref: "/holidays",
  },
  {
    key: "tags",
    label: "Tags",
    glyph: "🏷️",
    types: ["tag"],
    browseHref: "/tags",
  },
];

/** The category a `?type=` names, or `undefined` for absent or unrecognised. */
export function categoryFor(
  key: string | undefined,
): SearchCategory | undefined {
  if (key === undefined) return undefined;
  return SEARCH_CATEGORIES.find((category) => category.key === key);
}

/**
 * Narrow results to a category, client-side.
 *
 * The search service takes no type argument and does not need one: it caps at 50
 * hits from an in-memory pass, so filtering the answer costs nothing and filtering
 * the *query* would mean a new core surface, a new repo path, and a second place
 * for the two clients to disagree about what "a person result" means.
 *
 * No category means no narrowing — an unfiltered search is the whole point of a
 * global one.
 */
export function filterHits(
  hits: readonly SearchHit[],
  category: SearchCategory | undefined,
): SearchHit[] {
  if (category === undefined) return [...hits];
  return hits.filter((hit) => category.types.includes(hit.entityType));
}
