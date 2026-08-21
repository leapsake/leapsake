import { describe, expect, it } from "vitest";
import { isGiven, sortGiftsGivenLast, sortIdeasGivenLast } from "./gifts.js";

/** A link row, trimmed to what the sorts read (plus a title to assert on). */
const link = (title: string, givenAt: number | null = null) => ({
  title,
  givenAt,
});

const titleOf = (row: { title: string }) => row.title;

describe("isGiven", () => {
  it("reads the stamp as a boolean and nothing more", () => {
    expect(isGiven({ givenAt: null })).toBe(false);
    expect(isGiven({ givenAt: 0 })).toBe(true);
    expect(isGiven({ givenAt: Date.now() })).toBe(true);
  });
});

describe("sortGiftsGivenLast", () => {
  it("sinks given links below outstanding ones, alphabetically within each half", () => {
    const rows = [
      link("Zither", 1),
      link("Banjo"),
      link("Accordion", 2),
      link("Anvil"),
    ];

    expect(sortGiftsGivenLast(rows, titleOf).map(titleOf)).toEqual([
      "Anvil",
      "Banjo",
      "Accordion",
      "Zither",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const rows = [link("Zither", 1), link("Anvil")];
    sortGiftsGivenLast(rows, titleOf);

    expect(rows.map(titleOf)).toEqual(["Zither", "Anvil"]);
  });

  it("returns nothing for a party with no gifts", () => {
    expect(sortGiftsGivenLast([], titleOf)).toEqual([]);
  });
});

describe("sortIdeasGivenLast", () => {
  it("sinks an idea once everyone on it has been given it", () => {
    const rows = [
      { id: "all-given", recipients: [link("x", 1), link("y", 2)] },
      { id: "none-given", recipients: [link("x"), link("y")] },
      { id: "part-given", recipients: [link("x", 1), link("y")] },
    ];

    expect(sortIdeasGivenLast(rows).map((r) => r.id)).toEqual([
      "none-given",
      "part-given",
      "all-given",
    ]);
  });

  it("keeps an idea nobody is down for on top — it is still a thing to give", () => {
    const rows = [
      { id: "given", recipients: [link("x", 1)] },
      { id: "nobody", recipients: [] },
    ];

    expect(sortIdeasGivenLast(rows).map((r) => r.id)).toEqual([
      "nobody",
      "given",
    ]);
  });

  it("keeps the incoming order within each half", () => {
    const rows = [
      { id: "given-first", recipients: [link("x", 1)] },
      { id: "open-first", recipients: [link("x")] },
      { id: "given-second", recipients: [link("y", 2)] },
      { id: "open-second", recipients: [link("y")] },
    ];

    expect(sortIdeasGivenLast(rows).map((r) => r.id)).toEqual([
      "open-first",
      "open-second",
      "given-first",
      "given-second",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const rows = [{ recipients: [link("x", 1)] }, { recipients: [] }];
    sortIdeasGivenLast(rows);

    expect(rows[0].recipients).toHaveLength(1);
  });
});
