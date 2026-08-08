import { describe, expect, it } from "vitest";
import {
  applyDraftEdit,
  draftFromMarkup,
  insertMentionInDraft,
  markupFromDraft,
  splitDraft,
} from "./mention-draft.js";
import { mentionToken, parseMentions } from "./mention.js";

const ALICE = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const REX = "11111111-2222-4333-8444-555555555555";

const ALICE_MENTION = {
  displayName: "Alice Ng",
  targetType: "person" as const,
  targetId: ALICE,
};
const REX_MENTION = {
  displayName: "Rex",
  targetType: "pet" as const,
  targetId: REX,
};

const aliceToken = mentionToken("Alice Ng", "person", ALICE);
const rexToken = mentionToken("Rex", "pet", REX);

describe("draftFromMarkup", () => {
  it("shows '@name' in place of the token and records where it sits", () => {
    const draft = draftFromMarkup(`🎂 ${aliceToken}'s day #party`);
    expect(draft.text).toBe("🎂 @Alice Ng's day #party");
    expect(draft.spans).toEqual([{ start: 3, end: 12, ...ALICE_MENTION }]);
    // The span covers exactly the run a reader sees, sigil included.
    expect(draft.text.slice(3, 12)).toBe("@Alice Ng");
  });

  it("copies prose and #tags through untouched", () => {
    expect(draftFromMarkup("just prose #tag")).toEqual({
      text: "just prose #tag",
      spans: [],
    });
    expect(draftFromMarkup("")).toEqual({ text: "", spans: [] });
  });

  it("handles several mentions, keeping the spans in order", () => {
    const draft = draftFromMarkup(`${aliceToken} & ${rexToken}`);
    expect(draft.text).toBe("@Alice Ng & @Rex");
    expect(draft.spans.map((s) => [s.start, s.end])).toEqual([
      [0, 9],
      [12, 16],
    ]);
  });
});

describe("markupFromDraft", () => {
  it("round-trips markup through the draft unchanged", () => {
    for (const markup of [
      `🎂 ${aliceToken}'s day #party`,
      `${aliceToken} & ${rexToken}`,
      "just prose #tag",
      "",
    ]) {
      expect(markupFromDraft(draftFromMarkup(markup))).toBe(markup);
    }
  });

  it("drops a span whose text no longer says the name", () => {
    // What a hand-built (or stale) draft would look like — the letters stay,
    // the id doesn't.
    const draft = {
      text: "@Alice N",
      spans: [{ start: 0, end: 9, ...ALICE_MENTION }],
    };
    expect(markupFromDraft(draft)).toBe("@Alice N");
  });
});

describe("applyDraftEdit", () => {
  const draft = () => draftFromMarkup(`call ${aliceToken} today`);

  it("leaves a mention alone when the edit lands after it", () => {
    // "call @Alice Ng today" → "call @Alice Ng today!"
    const next = applyDraftEdit(draft(), "call @Alice Ng today!");
    expect(next.spans).toEqual([{ start: 5, end: 14, ...ALICE_MENTION }]);
    expect(markupFromDraft(next)).toBe(`call ${aliceToken} today!`);
  });

  it("keeps a mention when a character is typed immediately after it", () => {
    const next = applyDraftEdit(draft(), "call @Alice Ng, today");
    expect(next.spans).toEqual([{ start: 5, end: 14, ...ALICE_MENTION }]);
  });

  it("shifts a mention when text is inserted before it", () => {
    const next = applyDraftEdit(draft(), "please call @Alice Ng today");
    expect(next.spans).toEqual([{ start: 12, end: 21, ...ALICE_MENTION }]);
    expect(markupFromDraft(next)).toBe(`please call ${aliceToken} today`);
  });

  it("drops the mention when the edit reaches into it — it decays to text", () => {
    // Backspace at the end of the name.
    const next = applyDraftEdit(draft(), "call @Alice N today");
    expect(next.spans).toEqual([]);
    expect(markupFromDraft(next)).toBe("call @Alice N today");
    // And it stays plain: re-parsing the markup finds no mention.
    expect(parseMentions(markupFromDraft(next))).toEqual([]);
  });

  it("drops only the mention the edit touched", () => {
    const two = draftFromMarkup(`${aliceToken} & ${rexToken}`);
    // Delete the "N" from "Ng".
    const next = applyDraftEdit(two, "@Alice g & @Rex");
    expect(next.spans).toEqual([{ start: 11, end: 15, ...REX_MENTION }]);
    expect(markupFromDraft(next)).toBe(`@Alice g & ${rexToken}`);
  });

  it("survives a wholesale replacement (select-all and retype)", () => {
    expect(applyDraftEdit(draft(), "something else")).toEqual({
      text: "something else",
      spans: [],
    });
  });

  it("returns the same draft when nothing changed", () => {
    const before = draft();
    expect(applyDraftEdit(before, before.text)).toBe(before);
  });
});

describe("insertMentionInDraft", () => {
  it("replaces the active fragment with '@name' plus a trailing space", () => {
    const result = insertMentionInDraft(
      { text: "email @ali", spans: [] },
      10,
      ALICE_MENTION,
    );
    expect(result.draft.text).toBe("email @Alice Ng ");
    // Caret sits just after the name, before the trailing space.
    expect(result.caret).toBe(15);
    expect(result.draft.spans).toEqual([
      { start: 6, end: 15, ...ALICE_MENTION },
    ]);
    expect(result.draft.text.slice(6, 15)).toBe("@Alice Ng");
  });

  it("preserves text after the caret", () => {
    const result = insertMentionInDraft(
      { text: "hi @ali there", spans: [] },
      7,
      ALICE_MENTION,
    );
    expect(result.draft.text).toBe("hi @Alice Ng there");
  });

  it("does not double the space when the next char is already whitespace", () => {
    const result = insertMentionInDraft(
      { text: "@ali there", spans: [] },
      4,
      ALICE_MENTION,
    );
    expect(result.draft.text).toBe("@Alice Ng there");
    expect(result.caret).toBe(9); // before the pre-existing space
  });

  it("splices in from a bare '@'", () => {
    const result = insertMentionInDraft(
      { text: "@", spans: [] },
      1,
      ALICE_MENTION,
    );
    expect(result.draft.text).toBe("@Alice Ng ");
  });

  it("shifts the mentions that follow the insertion", () => {
    const start = insertMentionInDraft(
      { text: "@re and @al", spans: [] },
      3,
      REX_MENTION,
    );
    expect(start.draft.text).toBe("@Rex and @al");
    const both = insertMentionInDraft(start.draft, 12, ALICE_MENTION);
    expect(both.draft.text).toBe("@Rex and @Alice Ng ");
    expect(both.draft.spans).toEqual([
      { start: 0, end: 4, ...REX_MENTION },
      { start: 9, end: 18, ...ALICE_MENTION },
    ]);
  });

  it("round-trips to markup the write path can parse", () => {
    const { draft } = insertMentionInDraft(
      { text: "ping @al", spans: [] },
      8,
      ALICE_MENTION,
    );
    expect(markupFromDraft(draft)).toBe(`ping ${aliceToken} `);
    expect(parseMentions(markupFromDraft(draft))).toEqual([ALICE_MENTION]);
  });
});

describe("splitDraft", () => {
  it("splits into plain and mention runs that rebuild the text", () => {
    const draft = draftFromMarkup(`call ${aliceToken} and ${rexToken}`);
    expect(splitDraft(draft).map((s) => [s.text, s.mention !== null])).toEqual([
      ["call ", false],
      ["@Alice Ng", true],
      [" and ", false],
      ["@Rex", true],
    ]);
    expect(
      splitDraft(draft)
        .map((s) => s.text)
        .join(""),
    ).toBe(draft.text);
  });

  it("returns one plain run for text with no mentions, and [] for empty", () => {
    expect(splitDraft({ text: "buy milk", spans: [] })).toEqual([
      { text: "buy milk", mention: null },
    ]);
    expect(splitDraft({ text: "", spans: [] })).toEqual([]);
  });
});
