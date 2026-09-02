import type { SearchHit, SearchResultType } from "@leapsake/schema";

/**
 * One kind of record, as the search screen talks about it: one removable chip on
 * a narrowed search, and one token in what `?type=` carries.
 *
 * A facet is the *filter's* unit, and it is deliberately finer than a
 * {@link SearchCategory}: the browse grid answers "what catalogs are in here?",
 * where People and Pets are one answer, while a narrowed search answers "what am
 * I willing to be shown", where they are two — a user who came from People & Pets
 * looking for a person shouldn't have to keep the pets to keep the people.
 */
export interface SearchFacet {
  /** The one hit type this admits — and the token `?type=` carries for it. */
  type: SearchResultType;
  label: string;
  glyph: string;
  /** The catalog this kind of record is listed in, for browsing rather than searching. */
  browseHref: string;
}

/**
 * Every kind of record search can return, in the order chips appear.
 *
 * People and pets share `/people` because they share a list — the two facets
 * differ in what they *match*, not in where they are kept.
 */
export const SEARCH_FACETS: readonly SearchFacet[] = [
  { type: "person", label: "People", glyph: "👤", browseHref: "/people" },
  { type: "pet", label: "Pets", glyph: "🐾", browseHref: "/people" },
  {
    type: "gift_idea",
    label: "Gift ideas",
    glyph: "🎁",
    browseHref: "/gifts",
  },
  { type: "holiday", label: "Holidays", glyph: "🎉", browseHref: "/holidays" },
  { type: "tag", label: "Tags", glyph: "🏷️", browseHref: "/tags" },
];

/**
 * One tile on Search's browse grid, and one catalog's worth of 🔍.
 *
 * A category is **not** a single {@link SearchFacet}: people and pets are two
 * record types and one catalog, and the app's own list screen has always shown
 * them together as "People & Pets". So a category owns a *set* of facets — the
 * ones its 🔍 hands to the search screen, which the user can then take apart.
 */
export interface SearchCategory {
  /**
   * Which catalog this is. Stable — it names the header links a catalog carries
   * (`search-here-<key>`), which the E2E flows tap by id. It is no longer what
   * `?type=` carries: the filter is a list of facets now, because a filter you
   * can only drop whole is not a filter the user can steer.
   */
  key: string;
  label: string;
  glyph: string;
  /** The kinds of record this catalog holds — the chips its 🔍 arrives with. */
  types: readonly SearchResultType[];
  /** The full list behind the tile, for browsing rather than searching. */
  browseHref: string;
}

/**
 * The browse grid, and the app's whole answer to "what kinds of thing are in
 * here?".
 *
 * One table, two readers: the tiles on Search's empty state, and the facets a
 * catalog's 🔍 starts a search with. Adding a kind of record should be one entry
 * here (and one in {@link SEARCH_FACETS}) rather than two edits that can
 * disagree.
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

/** The category a catalog's 🔍 names, or `undefined` for an unrecognised key. */
export function categoryFor(
  key: string | undefined,
): SearchCategory | undefined {
  if (key === undefined) return undefined;
  return SEARCH_CATEGORIES.find((category) => category.key === key);
}

/**
 * Read `?type=` — a comma-separated list of facet types.
 *
 * Always in table order rather than the URL's, so the chips a user sees don't
 * depend on which one they happened to drop first. Unrecognised tokens are
 * dropped rather than treated as a filter matching nothing, so a stale link
 * degrades to a broader search instead of an empty one.
 */
export function facetsFor(param: string | undefined): SearchFacet[] {
  if (param === undefined) return [];
  const wanted = param.split(",");
  return SEARCH_FACETS.filter((facet) => wanted.includes(facet.type));
}

/**
 * Write `?type=` — `undefined` for an empty selection, which is how the filter
 * is *cleared*: expo-router drops a param set to `undefined`, and no param is
 * what an unfiltered search looks like.
 */
export function facetParam(facets: readonly SearchFacet[]): string | undefined {
  if (facets.length === 0) return undefined;
  return facets.map((facet) => facet.type).join(",");
}

/** The facets a catalog's 🔍 starts with, in table order. */
export function facetsOf(category: SearchCategory): SearchFacet[] {
  return SEARCH_FACETS.filter((facet) => category.types.includes(facet.type));
}

/**
 * The selection, said out loud: "people", "people and pets", "people, pets and
 * tags". Lower-cased, because every use of it is mid-sentence.
 */
export function facetPhrase(facets: readonly SearchFacet[]): string {
  const labels = facets.map((facet) => facet.label.toLocaleLowerCase());
  if (labels.length < 2) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * Narrow results to a selection of facets, client-side.
 *
 * The search service takes no type argument and does not need one: it caps at 50
 * hits from an in-memory pass, so filtering the answer costs nothing and filtering
 * the *query* would mean a new core surface, a new repo path, and a second place
 * for the two clients to disagree about what "a person result" means.
 *
 * An empty selection means no narrowing — an unfiltered search is the whole point
 * of a global one, and it is also where dropping the last chip lands.
 */
export function filterHits(
  hits: readonly SearchHit[],
  facets: readonly SearchFacet[],
): SearchHit[] {
  if (facets.length === 0) return [...hits];
  const types = new Set(facets.map((facet) => facet.type));
  return hits.filter((hit) => types.has(hit.entityType));
}
