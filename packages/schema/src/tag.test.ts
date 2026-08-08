import { describe, expect, it } from "vitest";
// The compose-surface hashtag authoring helpers are the twin of the `@mention`
// ones and live beside them in `mention.ts` (they share the placed-mention
// guard), but they mirror this file's tag grammar, so their edge cases are
// tested here.
import { draftFromMarkup, insertTagInDraft } from "./composer-draft.js";
import { activeHashtagQuery, mentionToken } from "./mention.js";
import {
  normalizeTagName,
  parseHashtags,
  parseTagNames,
  splitHashtags,
} from "./tag.js";

const ALICE = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

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

describe("activeHashtagQuery", () => {
  it("opens at a '#' at string start, up to the caret", () => {
    expect(activeHashtagQuery("#fam", 4)).toEqual({ query: "fam", start: 0 });
  });

  it("opens at a '#' right after whitespace", () => {
    // "call #fam" — caret at end.
    expect(activeHashtagQuery("call #fam", 9)).toEqual({
      query: "fam",
      start: 5,
    });
  });

  it("reads only up to the caret, ignoring text after it", () => {
    // "#family" with the caret right after "fam".
    expect(activeHashtagQuery("#family", 4)).toEqual({
      query: "fam",
      start: 0,
    });
  });

  it("treats a bare '#' with nothing after it as an empty active query", () => {
    expect(activeHashtagQuery("#", 1)).toEqual({ query: "", start: 0 });
    expect(activeHashtagQuery("tag me #", 8)).toEqual({ query: "", start: 7 });
  });

  it("ends the fragment at the first non-alphanumeric char", () => {
    // A trailing space has closed the tag: the caret is no longer in a fragment.
    expect(activeHashtagQuery("#fam ", 5)).toBeNull();
    // Caret sitting on the punctuation right after the tag: closed.
    expect(activeHashtagQuery("#fam.", 5)).toBeNull();
  });

  it("returns null for a mid-word '#' and a doubled '##'", () => {
    expect(activeHashtagQuery("a#b", 3)).toBeNull();
    expect(activeHashtagQuery("##fam", 5)).toBeNull();
  });

  it("returns null once the caret is past a newline from the '#'", () => {
    expect(activeHashtagQuery("#fam\nily", 8)).toBeNull();
  });

  it("returns null when the caret isn't after any '#' (deleted back past it)", () => {
    expect(activeHashtagQuery("fam", 3)).toBeNull();
    expect(activeHashtagQuery("", 0)).toBeNull();
  });

  it("keeps a completed earlier #tag out of a later fragment's query", () => {
    // "#one #tw" — caret at end is the *second* fragment only.
    expect(activeHashtagQuery("#one #tw", 8)).toEqual({
      query: "tw",
      start: 5,
    });
  });

  it("does not fire on a '#' embedded in a mention's display name", () => {
    // What the composer shows for `@[Team #1](person:…)` — the '#' is part of
    // the name, and the span is what says so.
    const { text, spans } = draftFromMarkup(
      `${mentionToken("Team #1", "person", ALICE)} `,
    );
    expect(text).toBe("@Team #1 ");
    // Caret parked just after the "#1" inside the name — not a live hashtag.
    expect(activeHashtagQuery(text, text.indexOf("#1") + 2, spans)).toBeNull();
    // Caret at the very end (after the whole name + space) is also not a query.
    expect(activeHashtagQuery(text, text.length, spans)).toBeNull();
  });

  it("opens on a '#' typed after a placed mention", () => {
    const { spans } = draftFromMarkup(
      mentionToken("Alice Ng", "person", ALICE),
    );
    const text = "@Alice Ng #par";
    expect(activeHashtagQuery(text, text.length, spans)).toEqual({
      query: "par",
      start: 10,
    });
  });
});

/** A prose draft over `text` with nothing chipped yet — a field mid-typing. */
function typing(text: string) {
  return { text, spans: [], grammar: "prose" as const };
}

describe("insertTagInDraft", () => {
  it("replaces the active fragment with #<tag> and adds a trailing space", () => {
    const result = insertTagInDraft(typing("call #fa"), 8, "family");
    expect(result.draft.text).toBe("call #family ");
    // Caret sits at the chip's end, before the trailing space.
    expect(result.caret).toBe("call #family".length);
  });

  it("preserves text after the caret", () => {
    const result = insertTagInDraft(typing("call #fa soon"), 8, "family");
    expect(result.draft.text).toBe("call #family soon");
  });

  it("does not double the space when the following char is already whitespace", () => {
    const result = insertTagInDraft(typing("#fa there"), 3, "family");
    expect(result.draft.text).toBe("#family there");
    expect(result.caret).toBe("#family".length); // before the pre-existing space
  });

  it("splices a tag in from a bare '#'", () => {
    expect(insertTagInDraft(typing("#"), 1, "family").draft.text).toBe(
      "#family ",
    );
  });

  it("round-trips: the inserted tag parses back out of the text", () => {
    const { draft } = insertTagInDraft(typing("tag me #fa"), 10, "Family");
    expect(parseHashtags(draft.text)).toEqual(["Family"]);
  });
});
