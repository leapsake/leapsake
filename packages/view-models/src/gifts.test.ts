import { describe, expect, it } from "vitest";
import { groupGiftsByIdea, sortIdeasGivenLast } from "./gifts.js";

/** A suggestion row, trimmed to what the grouping reads (plus an id to assert on). */
const suggestion = (id: string, ideaId: string, title: string) => ({
  id,
  giftIdeaId: ideaId,
  ideaTitle: title,
  ideaUrl: null,
});

/** A giving row, same shape. */
const giving = (id: string, ideaId: string, title: string) => ({
  id,
  giftIdeaId: ideaId,
  ideaTitle: title,
  ideaUrl: null,
});

describe("groupGiftsByIdea", () => {
  it("unions both tables into one entry per idea", () => {
    const groups = groupGiftsByIdea(
      [suggestion("s1", "idea-a", "Kite"), suggestion("s2", "idea-a", "Kite")],
      [giving("g1", "idea-a", "Kite")],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].ideaId).toBe("idea-a");
    expect(groups[0].suggestions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(groups[0].gifts.map((g) => g.id)).toEqual(["g1"]);
  });

  it("carries the idea's title and url from whichever row arrives first", () => {
    const groups = groupGiftsByIdea(
      [],
      [{ ...giving("g1", "idea-a", "Kite"), ideaUrl: "https://kites.example" }],
    );

    expect(groups[0].title).toBe("Kite");
    expect(groups[0].url).toBe("https://kites.example");
  });

  it("sinks given ideas below candidates, alphabetically within each half", () => {
    const groups = groupGiftsByIdea(
      [
        suggestion("s1", "given-z", "Zither"),
        suggestion("s2", "open-b", "Banjo"),
        suggestion("s3", "given-a", "Accordion"),
        suggestion("s4", "open-a", "Anvil"),
      ],
      [giving("g1", "given-z", "Zither"), giving("g2", "given-a", "Accordion")],
    );

    expect(groups.map((g) => g.title)).toEqual([
      "Anvil",
      "Banjo",
      "Accordion",
      "Zither",
    ]);
  });

  it("keeps a giving-only idea in the list", () => {
    const groups = groupGiftsByIdea([], [giving("g1", "idea-a", "Kite")]);

    expect(groups.map((g) => g.ideaId)).toEqual(["idea-a"]);
    expect(groups[0].suggestions).toEqual([]);
  });

  it("returns nothing for a recipient with no gifts either way", () => {
    expect(groupGiftsByIdea([], [])).toEqual([]);
  });
});

describe("sortIdeasGivenLast", () => {
  it("sinks ideas that have been given, keeping the incoming order within each half", () => {
    const rows = [
      { id: "given-first", gifts: [{}] },
      { id: "open-first", gifts: [] },
      { id: "given-second", gifts: [{}, {}] },
      { id: "open-second", gifts: [] },
    ];

    expect(sortIdeasGivenLast(rows).map((r) => r.id)).toEqual([
      "open-first",
      "open-second",
      "given-first",
      "given-second",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const rows = [{ gifts: [{}] }, { gifts: [] }];
    sortIdeasGivenLast(rows);

    expect(rows[0].gifts).toHaveLength(1);
  });
});
