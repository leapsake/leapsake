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
  /** What `?type=` carries. Stable — it is in URLs and in the New resolver. */
  key: string;
  label: string;
  glyph: string;
  /** The hit types this category admits. */
  types: readonly SearchResultType[];
  /** The full list behind the tile, for browsing rather than searching. */
  browseHref: string;
  /**
   * Where **New** goes while this category is the active filter, or `undefined`
   * where the category holds nothing a user authors: a holiday comes from the
   * seeded catalog, and a tag exists only because something wears it.
   */
  createHref?: string;
}

/**
 * The browse grid, and the app's whole answer to "what kinds of thing are in
 * here?".
 *
 * One table, three readers: the tiles on Search's empty state, the filter that
 * narrows its results, and `lib/new-action.ts` deciding what New means on a
 * filtered search. Adding a kind of record should be one entry here rather than
 * three edits that can disagree.
 *
 * People leads because it is what the app is mostly about; the rest follow in
 * the order they were built.
 */
export const SEARCH_CATEGORIES: readonly SearchCategory[] = [
  {
    key: "people",
    label: "People & Pets",
    glyph: "👥",
    types: ["person", "pet"],
    browseHref: "/people",
    createHref: "/add",
  },
  {
    key: "gifts",
    label: "Gift ideas",
    glyph: "🎁",
    types: ["gift_idea"],
    browseHref: "/gifts",
    createHref: "/gifts/new",
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
