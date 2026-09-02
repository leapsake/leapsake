import type { SearchHit } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  SEARCH_CATEGORIES,
  SEARCH_FACETS,
  categoryFor,
  facetParam,
  facetsFor,
  facetsOf,
  filterHits,
} from "./search-categories";

const hit = (
  entityType: SearchHit["entityType"],
  title: string,
): SearchHit => ({
  entityType,
  entityId: title,
  title,
  reasons: [],
});

const HITS = [
  hit("person", "Ada"),
  hit("pet", "Biscuit"),
  hit("gift_idea", "A telescope"),
  hit("holiday", "Christmas"),
  hit("tag", "family"),
];

const titles = (hits: SearchHit[]) => hits.map((h) => h.title);

describe("categoryFor", () => {
  it("finds a category by the key a catalog's 🔍 carries", () => {
    expect(categoryFor("people")?.label).toBe("People & Pets");
  });

  it("has no opinion about an absent or unrecognised key", () => {
    expect(categoryFor(undefined)).toBeUndefined();
    expect(categoryFor("nonsense")).toBeUndefined();
  });
});

describe("facetsOf", () => {
  it("hands a catalog's 🔍 one facet per kind of record it holds", () => {
    // People & Pets is one catalog and two chips: the whole point of the split.
    expect(facetsOf(categoryFor("people")!).map((f) => f.type)).toEqual([
      "person",
      "pet",
    ]);
    expect(facetsOf(categoryFor("gifts")!).map((f) => f.type)).toEqual([
      "gift_idea",
    ]);
  });
});

describe("facetsFor / facetParam", () => {
  it("round-trips a selection through the URL", () => {
    const facets = facetsOf(categoryFor("people")!);
    expect(facetParam(facets)).toBe("person,pet");
    expect(facetsFor("person,pet")).toEqual(facets);
  });

  it("writes no param for an empty selection, which is an unfiltered search", () => {
    // `undefined` is what expo-router drops, so dropping the last chip clears
    // `?type=` rather than leaving `?type=` behind matching nothing.
    expect(facetParam([])).toBeUndefined();
    expect(facetsFor(undefined)).toEqual([]);
  });

  it("reads back in table order, not the order the user dropped things in", () => {
    expect(facetsFor("pet,person").map((f) => f.type)).toEqual([
      "person",
      "pet",
    ]);
  });

  it("drops unrecognised tokens rather than filtering to nothing", () => {
    // A stale link should widen to a search that shows too much, never one that
    // shows nothing with no visible reason.
    expect(facetsFor("nonsense").map((f) => f.type)).toEqual([]);
    expect(facetsFor("person,nonsense").map((f) => f.type)).toEqual(["person"]);
  });
});

describe("filterHits", () => {
  it("does not narrow when nothing is filtered", () => {
    expect(titles(filterHits(HITS, []))).toEqual(titles(HITS));
  });

  it("narrows to a single kind of record", () => {
    expect(titles(filterHits(HITS, facetsFor("person")))).toEqual(["Ada"]);
    expect(titles(filterHits(HITS, facetsFor("pet")))).toEqual(["Biscuit"]);
  });

  it("keeps people and pets when both chips are up", () => {
    expect(titles(filterHits(HITS, facetsFor("person,pet")))).toEqual([
      "Ada",
      "Biscuit",
    ]);
  });

  it("returns nothing rather than everything when a facet matches no hit", () => {
    expect(filterHits([hit("person", "Ada")], facetsFor("holiday"))).toEqual(
      [],
    );
  });

  it("does not hand back the caller's array to mutate", () => {
    const source = [hit("person", "Ada")];
    expect(filterHits(source, [])).not.toBe(source);
  });
});

describe("the tables", () => {
  it("covers every hit type the search service can return", () => {
    // A new SearchResultType with no facet would be invisible on the browse
    // grid and silently dropped by every filter that isn't its own.
    expect(SEARCH_FACETS.map((f) => f.type).sort()).toEqual([
      "gift_idea",
      "holiday",
      "person",
      "pet",
      "tag",
    ]);
  });

  it("gives every category's types a facet to render", () => {
    for (const category of SEARCH_CATEGORIES) {
      expect(facetsOf(category).map((f) => f.type)).toEqual([
        ...category.types,
      ]);
    }
  });

  it("keys are unique, since a 🔍 resolves to exactly one", () => {
    const keys = SEARCH_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
