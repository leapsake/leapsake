import type { SearchHit } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  SEARCH_CATEGORIES,
  categoryFor,
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
  it("finds a category by the key its URL carries", () => {
    expect(categoryFor("people")?.label).toBe("People & Pets");
  });

  it("has no opinion about an absent or unrecognised key", () => {
    expect(categoryFor(undefined)).toBeUndefined();
    expect(categoryFor("nonsense")).toBeUndefined();
  });
});

describe("filterHits", () => {
  it("does not narrow when nothing is filtered", () => {
    expect(titles(filterHits(HITS, undefined))).toEqual(titles(HITS));
  });

  it("keeps people and pets together under one category", () => {
    // Two record types, one idea — a user looking for "the people I know" is
    // not making the distinction the schema makes.
    expect(titles(filterHits(HITS, categoryFor("people")))).toEqual([
      "Ada",
      "Biscuit",
    ]);
  });

  it("narrows to a single-type category", () => {
    expect(titles(filterHits(HITS, categoryFor("gifts")))).toEqual([
      "A telescope",
    ]);
    expect(titles(filterHits(HITS, categoryFor("tags")))).toEqual(["family"]);
  });

  it("returns nothing rather than everything when a category matches no hit", () => {
    expect(filterHits([hit("person", "Ada")], categoryFor("holidays"))).toEqual(
      [],
    );
  });

  it("does not hand back the caller's array to mutate", () => {
    const source = [hit("person", "Ada")];
    expect(filterHits(source, undefined)).not.toBe(source);
  });
});

describe("the category table", () => {
  it("covers every hit type the search service can return", () => {
    // A new SearchResultType with no category would be invisible on the browse
    // grid and silently dropped by every filter that isn't its own.
    const covered = new Set(SEARCH_CATEGORIES.flatMap((c) => c.types));
    expect([...covered].sort()).toEqual([
      "gift_idea",
      "holiday",
      "person",
      "pet",
      "tag",
    ]);
  });

  it("keys are unique, since a URL resolves to exactly one", () => {
    const keys = SEARCH_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
