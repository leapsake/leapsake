import type { SearchHit, SearchResultType } from "@leapsake/schema";

/**
 * One kind of record: a removable chip and a `?type=` token. Finer than a
 * {@link SearchCategory}, so people and pets can be dropped separately.
 */
export interface SearchFacet {
  /** The one hit type this admits — and the token `?type=` carries for it. */
  type: SearchResultType;
  label: string;
  glyph: string;
}

/** Every kind of record search can return, in the order chips appear. */
export const SEARCH_FACETS: readonly SearchFacet[] = [
  { type: "person", label: "People", glyph: "👤" },
  { type: "pet", label: "Pets", glyph: "🐾" },
  { type: "gift_idea", label: "Gift ideas", glyph: "🎁" },
  { type: "holiday", label: "Holidays", glyph: "🎉" },
  { type: "tag", label: "Tags", glyph: "🏷️" },
];

/** One tile on Search's browse grid, owning the facets its 🔍 starts with. */
export interface SearchCategory {
  /** Which catalog this is; also names its 🔍's testID, `search-here-<key>`. */
  key: string;
  label: string;
  glyph: string;
  /** The kinds of record this catalog holds — the chips its 🔍 arrives with. */
  types: readonly SearchResultType[];
  /** The full list behind the tile, for browsing rather than searching. */
  browseHref: string;
}

/**
 * The browse grid's tiles, in order, and the facets each catalog's 🔍 starts a
 * search with. What a catalog's ➕ makes is `lib/tab-screens.ts`'s.
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
 * Read `?type=`, in table order. An unrecognised token is dropped, so a stale
 * link broadens the search rather than emptying it.
 */
export function facetsFor(param: string | undefined): SearchFacet[] {
  if (param === undefined) return [];
  const wanted = param.split(",");
  return SEARCH_FACETS.filter((facet) => wanted.includes(facet.type));
}

/** Write `?type=`; `undefined` for none, which expo-router drops. */
export function facetParam(facets: readonly SearchFacet[]): string | undefined {
  if (facets.length === 0) return undefined;
  return facets.map((facet) => facet.type).join(",");
}

/** The facets a catalog's 🔍 starts with, in table order. */
export function facetsOf(category: SearchCategory): SearchFacet[] {
  return SEARCH_FACETS.filter((facet) => category.types.includes(facet.type));
}

/** Narrow results to the selected facets; an empty selection keeps all. */
export function filterHits(
  hits: readonly SearchHit[],
  facets: readonly SearchFacet[],
): SearchHit[] {
  if (facets.length === 0) return [...hits];
  const types = new Set(facets.map((facet) => facet.type));
  return hits.filter((hit) => types.has(hit.entityType));
}
