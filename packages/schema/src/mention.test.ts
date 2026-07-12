import { describe, expect, it } from "vitest";
import {
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

describe("plainMentionText", () => {
  it("replaces each token with its bare display name", () => {
    const text = `🎂 ${mentionToken("Alice Ng", "person", ALICE)}'s birthday`;
    expect(plainMentionText(text)).toBe("🎂 Alice Ng's birthday");
  });

  it("is idempotent and leaves token-free text untouched", () => {
    const once = plainMentionText(`hi ${mentionToken("Rex", "pet", REX)}`);
    expect(once).toBe("hi Rex");
    expect(plainMentionText(once)).toBe("hi Rex");
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
