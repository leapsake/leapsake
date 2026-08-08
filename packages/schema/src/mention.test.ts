import { describe, expect, it } from "vitest";
import { draftFromMarkup } from "./mention-draft.js";
import {
  activeMentionQuery,
  mentionToken,
  parseMentions,
  plainMentionText,
  splitAnnotatedText,
} from "./mention.js";

const ALICE = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const REX = "11111111-2222-4333-8444-555555555555";

describe("mentionToken", () => {
  it("builds a Markdown-link-style token carrying the target id", () => {
    expect(mentionToken("Alice Ng", "person", ALICE)).toBe(
      `@[Alice Ng](person:${ALICE})`,
    );
    expect(mentionToken("Rex", "pet", REX)).toBe(`@[Rex](pet:${REX})`);
  });
});

describe("parseMentions", () => {
  it("extracts the inline token's display, type, and id", () => {
    expect(
      parseMentions(`🎂 ${mentionToken("Alice Ng", "person", ALICE)}`),
    ).toEqual([
      { displayName: "Alice Ng", targetType: "person", targetId: ALICE },
    ]);
  });

  it("reads the name back through the possessive tail without swallowing it", () => {
    const text = `🎂 ${mentionToken("Alice Ng", "person", ALICE)}'s birthday`;
    expect(parseMentions(text)).toEqual([
      { displayName: "Alice Ng", targetType: "person", targetId: ALICE },
    ]);
  });

  it("ignores ordinary prose and a bare '@' — only a full token matches", () => {
    expect(parseMentions("email @alice about the trip")).toEqual([]);
    expect(parseMentions("no mentions here #family")).toEqual([]);
  });

  it("dedupes by target (type+id), keeping the first spelling", () => {
    const text = `${mentionToken("Alice", "person", ALICE)} and ${mentionToken("Alice Ng", "person", ALICE)}`;
    expect(parseMentions(text)).toEqual([
      { displayName: "Alice", targetType: "person", targetId: ALICE },
    ]);
  });

  it("keeps distinct targets separate, including a person vs pet collision-free", () => {
    const text = `${mentionToken("Alice Ng", "person", ALICE)} & ${mentionToken("Rex", "pet", REX)}`;
    expect(parseMentions(text).map((m) => m.targetId)).toEqual([ALICE, REX]);
  });

  it("returns [] for empty input", () => {
    expect(parseMentions("")).toEqual([]);
  });
});

describe("activeMentionQuery", () => {
  it("opens at an '@' at string start, up to the caret", () => {
    // "@ali" with the caret at the end.
    expect(activeMentionQuery("@ali", 4)).toEqual({ query: "ali", start: 0 });
  });

  it("opens at an '@' right after whitespace", () => {
    // "email @ali" — caret at end.
    expect(activeMentionQuery("email @ali", 10)).toEqual({
      query: "ali",
      start: 6,
    });
  });

  it("keeps spaces inside the fragment (names have spaces)", () => {
    expect(activeMentionQuery("@ali ng", 7)).toEqual({
      query: "ali ng",
      start: 0,
    });
  });

  it("treats a bare '@' with nothing after it as an empty active query", () => {
    expect(activeMentionQuery("@", 1)).toEqual({ query: "", start: 0 });
    expect(activeMentionQuery("call @", 6)).toEqual({ query: "", start: 5 });
  });

  it("reads only up to the caret, ignoring text after it", () => {
    // "hi @ali there" with the caret right after "ali".
    expect(activeMentionQuery("hi @ali there", 7)).toEqual({
      query: "ali",
      start: 3,
    });
  });

  it("returns null for a mid-word '@' (e.g. an email)", () => {
    expect(activeMentionQuery("foo@bar", 7)).toBeNull();
  });

  it("returns null once the caret is past a newline from the '@'", () => {
    expect(activeMentionQuery("@ali\nng", 7)).toBeNull();
  });

  it("returns null when the caret isn't after any '@' (deleted back past it)", () => {
    expect(activeMentionQuery("ali", 3)).toBeNull();
    expect(activeMentionQuery("", 0)).toBeNull();
  });

  // In the composer's displayed text a mention already taken reads "@Alice Ng",
  // which is indistinguishable from a name being typed — the spans are what tell
  // the two apart.
  it("returns null when the caret sits inside or just past a placed mention", () => {
    const { text, spans } = draftFromMarkup(
      `${mentionToken("Alice Ng", "person", ALICE)} `,
    );
    expect(text).toBe("@Alice Ng ");
    // Caret at the very end, after the whole mention + trailing space.
    expect(activeMentionQuery(text, text.length, spans)).toBeNull();
    // Caret parked in the middle of the name also reads as not-a-query.
    expect(activeMentionQuery(text, 5, spans)).toBeNull();
  });

  it("opens on a new '@' typed after a placed mention", () => {
    const { spans } = draftFromMarkup(
      mentionToken("Alice Ng", "person", ALICE),
    );
    const text = "@Alice Ng @re";
    expect(activeMentionQuery(text, text.length, spans)).toEqual({
      query: "re",
      start: 10,
    });
  });
});

describe("plainMentionText", () => {
  it("replaces each token with the '@name' a reader sees", () => {
    const text = `🎂 ${mentionToken("Alice Ng", "person", ALICE)}'s birthday`;
    expect(plainMentionText(text)).toBe("🎂 @Alice Ng's birthday");
  });

  it("is idempotent and leaves token-free text untouched", () => {
    const once = plainMentionText(`hi ${mentionToken("Rex", "pet", REX)}`);
    expect(once).toBe("hi @Rex");
    expect(plainMentionText(once)).toBe("hi @Rex");
    expect(plainMentionText("just prose #tag")).toBe("just prose #tag");
  });
});

describe("splitAnnotatedText", () => {
  it("marks #tags and @mentions in one pass, prose between them plain", () => {
    const text = `🎂 ${mentionToken("Alice Ng", "person", ALICE)}'s day #party`;
    expect(splitAnnotatedText(text)).toEqual([
      { kind: "text", text: "🎂 " },
      {
        kind: "mention",
        text: mentionToken("Alice Ng", "person", ALICE),
        displayName: "Alice Ng",
        targetType: "person",
        targetId: ALICE,
      },
      { kind: "text", text: "'s day " },
      { kind: "hashtag", text: "#party", tagName: "party" },
    ]);
  });

  it("preserves the original string when the segment texts are concatenated", () => {
    const text = `call ${mentionToken("Rex", "pet", REX)} #now, then rest`;
    expect(
      splitAnnotatedText(text)
        .map((s) => s.text)
        .join(""),
    ).toBe(text);
  });

  it("returns a single plain segment when there are no tokens, and [] for empty", () => {
    expect(splitAnnotatedText("buy milk")).toEqual([
      { kind: "text", text: "buy milk" },
    ]);
    expect(splitAnnotatedText("")).toEqual([]);
  });
});
