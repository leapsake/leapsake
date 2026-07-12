import { describe, expect, it } from "vitest";
import { normalizeTagName, parseHashtags, parseTagNames } from "./tag.js";

describe("parseTagNames", () => {
  it("splits on commas and whitespace alike", () => {
    expect(parseTagNames("Friend, Colleague")).toEqual(["Friend", "Colleague"]);
    expect(parseTagNames("Friend Colleague")).toEqual(["Friend", "Colleague"]);
    expect(parseTagNames("  Friend ,  Colleague ")).toEqual([
      "Friend",
      "Colleague",
    ]);
  });

  it("treats the optional '#' sigil as a separator, never stored content", () => {
    expect(parseTagNames("#Friend")).toEqual(["Friend"]);
    expect(parseTagNames("#Friend #Colleague")).toEqual([
      "Friend",
      "Colleague",
    ]);
    // A stray internal "#" just splits the token.
    expect(parseTagNames("Fri#end")).toEqual(["Fri", "end"]);
  });

  it("bans spaces and punctuation inside a tag by splitting on them", () => {
    // A multi-word entry becomes multiple single-word tags.
    expect(parseTagNames("Service Animal")).toEqual(["Service", "Animal"]);
    // Trailing/embedded punctuation (as in prose) terminates the tag.
    expect(parseTagNames("he is my #friend.")).toEqual([
      "he",
      "is",
      "my",
      "friend",
    ]);
    expect(parseTagNames("you are my #friend!")).toEqual([
      "you",
      "are",
      "my",
      "friend",
    ]);
    expect(parseTagNames("a-b_c")).toEqual(["a", "b", "c"]);
  });

  it("keeps letters and numbers, including accented letters", () => {
    expect(parseTagNames("Café 2024")).toEqual(["Café", "2024"]);
  });

  it("dedupes by normalized form, keeping the first spelling", () => {
    expect(parseTagNames("Friend, friend, #FRIEND")).toEqual(["Friend"]);
  });

  it("returns nothing for input with no letters or numbers", () => {
    expect(parseTagNames("")).toEqual([]);
    expect(parseTagNames("  #  , !! ")).toEqual([]);
  });
});

describe("parseHashtags", () => {
  it("extracts only #-prefixed tokens, leaving ordinary words alone", () => {
    expect(parseHashtags("call mom #family #urgent")).toEqual([
      "family",
      "urgent",
    ]);
    // No sigils → nothing (unlike parseTagNames, which would tag every word).
    expect(parseHashtags("buy milk and eggs")).toEqual([]);
  });

  it("stops a tag at the first non-alphanumeric character", () => {
    expect(parseHashtags("ask about the #trip, then #home.")).toEqual([
      "trip",
      "home",
    ]);
    expect(parseHashtags("#a-b")).toEqual(["a"]);
  });

  it("keeps accented letters and numbers; dedupes by normalized form", () => {
    expect(parseHashtags("#Café #2024")).toEqual(["Café", "2024"]);
    expect(parseHashtags("#Family #family #FAMILY")).toEqual(["Family"]);
  });

  it("returns nothing for a bare '#' or empty input", () => {
    expect(parseHashtags("")).toEqual([]);
    expect(parseHashtags("a # b")).toEqual([]);
  });
});

describe("normalizeTagName", () => {
  it("trims and lowercases", () => {
    expect(normalizeTagName(" Friend ")).toBe("friend");
    expect(normalizeTagName("FRIEND")).toBe("friend");
  });
});
