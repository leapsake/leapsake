import { describe, expect, it } from "vitest";
import {
  normalizeTagName,
  parseHashtags,
  parseTagNames,
  splitHashtags,
} from "./tag.js";

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

describe("splitHashtags", () => {
  it("marks each #tag and leaves the prose between them plain", () => {
    expect(splitHashtags("call mom #family soon")).toEqual([
      { text: "call mom ", tagName: null },
      { text: "#family", tagName: "family" },
      { text: " soon", tagName: null },
    ]);
  });

  it("marks the tag exactly as parseHashtags would, stopping at punctuation", () => {
    const segments = splitHashtags("ask about the #trip, then #home.");
    // The marked runs match parseHashtags one-for-one.
    expect(
      segments.filter((s) => s.tagName !== null).map((s) => s.tagName),
    ).toEqual(parseHashtags("ask about the #trip, then #home."));
    // The trailing comma/period stay as plain prose, not part of the tag.
    expect(segments).toContainEqual({ text: ", then ", tagName: null });
    expect(segments).toContainEqual({ text: ".", tagName: null });
  });

  it("handles adjacent tags and a leading tag with no plain run between", () => {
    expect(splitHashtags("#a#b")).toEqual([
      { text: "#a", tagName: "a" },
      { text: "#b", tagName: "b" },
    ]);
  });

  it("preserves the original string when concatenated back", () => {
    const text = "  #Café then #2024! and a bare # sign";
    expect(
      splitHashtags(text)
        .map((s) => s.text)
        .join(""),
    ).toBe(text);
  });

  it("returns a single plain segment when there are no tags, and [] for empty", () => {
    expect(splitHashtags("buy milk and eggs")).toEqual([
      { text: "buy milk and eggs", tagName: null },
    ]);
    expect(splitHashtags("")).toEqual([]);
  });
});

describe("normalizeTagName", () => {
  it("trims and lowercases", () => {
    expect(normalizeTagName(" Friend ")).toBe("friend");
    expect(normalizeTagName("FRIEND")).toBe("friend");
  });
});
