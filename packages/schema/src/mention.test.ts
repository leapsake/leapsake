import { describe, expect, it } from "vitest";
import { draftFromMarkup } from "./composer-draft.js";
import {
  activeMentionQuery,
  mentionToken,
  parseMentions,
  plainMentionText,
  splitAnnotatedText,
} from "./mention.js";

const VIOLET = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const JIMMY = "11111111-2222-4333-8444-555555555555";

describe("mentionToken", () => {
  it("builds a Markdown-link-style token carrying the target id", () => {
    expect(mentionToken("Violet Bick", "person", VIOLET)).toBe(
      `@[Violet Bick](person:${VIOLET})`,
    );
    expect(mentionToken("Jimmy", "pet", JIMMY)).toBe(`@[Jimmy](pet:${JIMMY})`);
  });
});

describe("parseMentions", () => {
  it("extracts the inline token's display, type, and id", () => {
    expect(
      parseMentions(`🎂 ${mentionToken("Violet Bick", "person", VIOLET)}`),
    ).toEqual([
      { displayName: "Violet Bick", targetType: "person", targetId: VIOLET },
    ]);
  });

  it("reads the name back through the possessive tail without swallowing it", () => {
    const text = `🎂 ${mentionToken("Violet Bick", "person", VIOLET)}'s birthday`;
    expect(parseMentions(text)).toEqual([
      { displayName: "Violet Bick", targetType: "person", targetId: VIOLET },
    ]);
  });

  it("ignores ordinary prose and a bare '@' — only a full token matches", () => {
    expect(parseMentions("email @violet about the trip")).toEqual([]);
    expect(parseMentions("no mentions here #family")).toEqual([]);
  });

  it("dedupes by target (type+id), keeping the first spelling", () => {
    const text = `${mentionToken("Violet", "person", VIOLET)} and ${mentionToken("Violet Bick", "person", VIOLET)}`;
    expect(parseMentions(text)).toEqual([
      { displayName: "Violet", targetType: "person", targetId: VIOLET },
    ]);
  });

  it("keeps distinct targets separate, including a person vs pet collision-free", () => {
    const text = `${mentionToken("Violet Bick", "person", VIOLET)} & ${mentionToken("Jimmy", "pet", JIMMY)}`;
    expect(parseMentions(text).map((m) => m.targetId)).toEqual([VIOLET, JIMMY]);
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

  // In the composer's displayed text a mention already taken reads "@Violet Bick",
  // which is indistinguishable from a name being typed — the spans are what tell
  // the two apart.
  it("returns null when the caret sits inside or just past a placed mention", () => {
    const { text, spans } = draftFromMarkup(
      `${mentionToken("Violet Bick", "person", VIOLET)} `,
    );
    expect(text).toBe("@Violet Bick ");
    // Caret at the very end, after the whole mention + trailing space.
    expect(activeMentionQuery(text, text.length, spans)).toBeNull();
    // Caret parked in the middle of the name also reads as not-a-query.
    expect(activeMentionQuery(text, 5, spans)).toBeNull();
  });

  it("opens on a new '@' typed after a placed mention", () => {
    const { spans } = draftFromMarkup(
      mentionToken("Violet Bick", "person", VIOLET),
    );
    const text = "@Violet Bick @re";
    expect(activeMentionQuery(text, text.length, spans)).toEqual({
      query: "re",
      start: 13,
    });
  });
});

describe("plainMentionText", () => {
  it("replaces each token with the '@name' a reader sees", () => {
    const text = `🎂 ${mentionToken("Violet Bick", "person", VIOLET)}'s birthday`;
    expect(plainMentionText(text)).toBe("🎂 @Violet Bick's birthday");
  });

  it("is idempotent and leaves token-free text untouched", () => {
    const once = plainMentionText(`hi ${mentionToken("Jimmy", "pet", JIMMY)}`);
    expect(once).toBe("hi @Jimmy");
    expect(plainMentionText(once)).toBe("hi @Jimmy");
    expect(plainMentionText("just prose #tag")).toBe("just prose #tag");
  });
});

describe("splitAnnotatedText", () => {
  it("marks #tags and @mentions in one pass, prose between them plain", () => {
    const text = `🎂 ${mentionToken("Violet Bick", "person", VIOLET)}'s day #party`;
    expect(splitAnnotatedText(text)).toEqual([
      { kind: "text", text: "🎂 " },
      {
        kind: "mention",
        text: mentionToken("Violet Bick", "person", VIOLET),
        displayName: "Violet Bick",
        targetType: "person",
        targetId: VIOLET,
      },
      { kind: "text", text: "'s day " },
      { kind: "hashtag", text: "#party", tagName: "party" },
    ]);
  });

  it("preserves the original string when the segment texts are concatenated", () => {
    const text = `call ${mentionToken("Jimmy", "pet", JIMMY)} #now, then rest`;
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
