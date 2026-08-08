import { describe, expect, it } from "vitest";
import {
  type ChipSpan,
  activeTagQuery,
  applyDraftEdit,
  draftFromMarkup,
  draftFromTagField,
  insertMentionInDraft,
  insertTagInDraft,
  markupFromDraft,
  snapCaret,
  snapSelection,
  splitDraft,
} from "./composer-draft.js";
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

const aliceChip = { kind: "mention" as const, ...ALICE_MENTION };
const rexChip = { kind: "mention" as const, ...REX_MENTION };

/** The chips as `[text, kind]`, which is what a renderer actually consumes. */
function chips(draft: { text: string; spans: ChipSpan[] }): [string, string][] {
  return draft.spans.map((s) => [draft.text.slice(s.start, s.end), s.kind]);
}

describe("draftFromMarkup", () => {
  it("shows '@name' in place of the token and records where it sits", () => {
    const draft = draftFromMarkup(`🎂 ${aliceToken}'s day`);
    expect(draft.text).toBe("🎂 @Alice Ng's day");
    expect(draft.spans).toEqual([{ start: 3, end: 12, ...aliceChip }]);
    // The chip covers exactly the run a reader sees, sigil included.
    expect(draft.text.slice(3, 12)).toBe("@Alice Ng");
  });

  it("opens every saved #tag as a chip — saved text has committed tags", () => {
    const draft = draftFromMarkup("call #family about #party");
    expect(chips(draft)).toEqual([
      ["#family", "tag"],
      ["#party", "tag"],
    ]);
  });

  it("leaves a '#' inside a mention's name to that mention", () => {
    const draft = draftFromMarkup(mentionToken("Team #1", "person", ALICE));
    expect(chips(draft)).toEqual([["@Team #1", "mention"]]);
  });

  it("copies prose through untouched", () => {
    expect(draftFromMarkup("just prose")).toEqual({
      text: "just prose",
      spans: [],
      grammar: "prose",
    });
    expect(draftFromMarkup("")).toEqual({
      text: "",
      spans: [],
      grammar: "prose",
    });
  });
});

describe("draftFromTagField", () => {
  it("chips every word — a bare one is stored exactly as a #-prefixed one", () => {
    const draft = draftFromTagField("#Friend Colleague");
    expect(chips(draft)).toEqual([
      ["#Friend", "tag"],
      ["Colleague", "tag"],
    ]);
    expect(draft.spans.map((s) => s.kind === "tag" && s.name)).toEqual([
      "Friend",
      "Colleague",
    ]);
  });

  it("is empty for an empty field", () => {
    expect(draftFromTagField("")).toEqual({
      text: "",
      spans: [],
      grammar: "tagField",
    });
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

  it("drops a mention chip whose text no longer says the name", () => {
    const draft = {
      text: "@Alice N",
      spans: [{ start: 0, end: 9, ...aliceChip }],
      grammar: "prose" as const,
    };
    expect(markupFromDraft(draft)).toBe("@Alice N");
  });
});

describe("applyDraftEdit — chips are atomic", () => {
  const withMention = () => draftFromMarkup(`call ${aliceToken} today`);

  it("deletes the whole chip when backspace lands at its end", () => {
    // "call @Alice Ng today" with the caret at the mention's end.
    const next = applyDraftEdit(withMention(), "call @Alice N today");
    expect(next.draft.text).toBe("call  today");
    expect(next.draft.spans).toEqual([]);
    // The caret goes where the chip began — more was removed than was typed.
    expect(next.caret).toBe(5);
    expect(parseMentions(markupFromDraft(next.draft))).toEqual([]);
  });

  it("takes the whole chip when a selection covering part of it is replaced", () => {
    const next = applyDraftEdit(withMention(), "call @Alice X today");
    expect(next.draft.text).toBe("call X today");
    expect(next.draft.spans).toEqual([]);
  });

  it("leaves a chip alone when the edit lands after it", () => {
    const next = applyDraftEdit(withMention(), "call @Alice Ng today!");
    expect(next.draft.spans).toEqual([{ start: 5, end: 14, ...aliceChip }]);
    expect(markupFromDraft(next.draft)).toBe(`call ${aliceToken} today!`);
  });

  it("keeps a chip when a character is typed immediately after it", () => {
    const next = applyDraftEdit(withMention(), "call @Alice Ng, today");
    expect(next.draft.spans).toEqual([{ start: 5, end: 14, ...aliceChip }]);
  });

  it("shifts a chip when text is inserted before it", () => {
    const next = applyDraftEdit(withMention(), "please call @Alice Ng today");
    expect(next.draft.spans).toEqual([{ start: 12, end: 21, ...aliceChip }]);
    expect(markupFromDraft(next.draft)).toBe(`please call ${aliceToken} today`);
  });

  it("takes only the chip the edit touched", () => {
    const two = draftFromMarkup(`${aliceToken} & ${rexToken}`);
    // Backspace at the end of "@Alice Ng".
    const next = applyDraftEdit(two, "@Alice N & @Rex");
    expect(next.draft.text).toBe(" & @Rex");
    expect(chips(next.draft)).toEqual([["@Rex", "mention"]]);
  });

  it("survives a wholesale replacement (select-all and retype)", () => {
    const next = applyDraftEdit(withMention(), "something else");
    expect(next.draft.text).toBe("something else");
    expect(next.draft.spans).toEqual([]);
  });

  it("returns the same draft when nothing changed", () => {
    const before = withMention();
    expect(applyDraftEdit(before, before.text).draft).toBe(before);
  });
});

describe("applyDraftEdit — when a tag becomes a chip", () => {
  const live = () => applyDraftEdit(draftFromMarkup(""), "call #fam").draft;

  it("does not chip a tag still being typed at the end of the text", () => {
    expect(live().spans).toEqual([]);
  });

  it("chips it as soon as a character ends it", () => {
    const next = applyDraftEdit(live(), "call #fam ");
    expect(chips(next.draft)).toEqual([["#fam", "tag"]]);
  });

  it("keeps the chip when that terminator is deleted again — chips are sticky", () => {
    const set = applyDraftEdit(live(), "call #fam ").draft;
    const next = applyDraftEdit(set, "call #fam");
    expect(chips(next.draft)).toEqual([["#fam", "tag"]]);
  });

  it("then deletes the whole tag on the next backspace", () => {
    const set = applyDraftEdit(live(), "call #fam ").draft;
    const back = applyDraftEdit(set, "call #fam").draft;
    const next = applyDraftEdit(back, "call #fa");
    expect(next.draft.text).toBe("call ");
    expect(next.draft.spans).toEqual([]);
    expect(next.caret).toBe(5);
  });

  it("grows the tag when typing at a chip's trailing edge", () => {
    const set = applyDraftEdit(live(), "call #fam ").draft;
    const next = applyDraftEdit(set, "call #family ");
    expect(chips(next.draft)).toEqual([["#family", "tag"]]);
    expect(next.draft.spans.map((s) => s.kind === "tag" && s.name)).toEqual([
      "family",
    ]);
  });

  it("chips every word in a tags field, once terminated", () => {
    const typed = applyDraftEdit(draftFromTagField(""), "Friend");
    expect(typed.draft.spans).toEqual([]);
    const next = applyDraftEdit(typed.draft, "Friend ");
    expect(chips(next.draft)).toEqual([["Friend", "tag"]]);
  });

  it("keeps one chip per run when two are joined by deleting a separator", () => {
    const two = draftFromTagField("work life");
    const next = applyDraftEdit(two, "worklife");
    // One run, so one chip — not two overlapping ones.
    expect(chips(next.draft)).toEqual([["worklife", "tag"]]);
  });
});

describe("activeTagQuery", () => {
  it("needs the '#' sigil in prose", () => {
    const draft = applyDraftEdit(draftFromMarkup(""), "call #fa").draft;
    expect(activeTagQuery(draft, 8)).toEqual({ query: "fa", start: 5 });
    const bare = applyDraftEdit(draftFromMarkup(""), "call fa").draft;
    expect(activeTagQuery(bare, 7)).toBeNull();
  });

  it("takes a bare word in a tags field, sigil optional", () => {
    const draft = applyDraftEdit(draftFromTagField(""), "Fri").draft;
    expect(activeTagQuery(draft, 3)).toEqual({ query: "Fri", start: 0 });
    const sigil = applyDraftEdit(draftFromTagField(""), "#Fri").draft;
    // `start` covers the sigil, so completing replaces it rather than doubling.
    expect(activeTagQuery(sigil, 4)).toEqual({ query: "Fri", start: 0 });
  });

  it("is not a query when the caret sits at a set chip's end", () => {
    const draft = draftFromTagField("Friend ");
    expect(activeTagQuery(draft, 6)).toBeNull();
  });
});

describe("insertMentionInDraft", () => {
  it("replaces the active fragment with '@name' plus a trailing space", () => {
    const result = insertMentionInDraft(
      { text: "email @ali", spans: [], grammar: "prose" },
      10,
      ALICE_MENTION,
    );
    expect(result.draft.text).toBe("email @Alice Ng ");
    // Caret sits at the chip's end, before the trailing space.
    expect(result.caret).toBe(15);
    expect(result.draft.spans).toEqual([{ start: 6, end: 15, ...aliceChip }]);
  });

  it("preserves text after the caret and does not double a space", () => {
    expect(
      insertMentionInDraft(
        { text: "hi @ali there", spans: [], grammar: "prose" },
        7,
        ALICE_MENTION,
      ).draft.text,
    ).toBe("hi @Alice Ng there");
  });

  it("shifts the chips that follow the insertion", () => {
    const start = insertMentionInDraft(
      { text: "@re and @al", spans: [], grammar: "prose" },
      3,
      REX_MENTION,
    );
    const both = insertMentionInDraft(start.draft, 12, ALICE_MENTION);
    expect(both.draft.text).toBe("@Rex and @Alice Ng ");
    expect(both.draft.spans).toEqual([
      { start: 0, end: 4, ...rexChip },
      { start: 9, end: 18, ...aliceChip },
    ]);
  });

  it("round-trips to markup the write path can parse", () => {
    const { draft } = insertMentionInDraft(
      { text: "ping @al", spans: [], grammar: "prose" },
      8,
      ALICE_MENTION,
    );
    expect(markupFromDraft(draft)).toBe(`ping ${aliceToken} `);
    expect(parseMentions(markupFromDraft(draft))).toEqual([ALICE_MENTION]);
  });
});

describe("insertTagInDraft", () => {
  it("chips a picked tag at once, without waiting for a terminator", () => {
    const draft = applyDraftEdit(draftFromMarkup(""), "call #fa").draft;
    const result = insertTagInDraft(draft, 8, "family");
    expect(result.draft.text).toBe("call #family ");
    expect(chips(result.draft)).toEqual([["#family", "tag"]]);
    expect(result.caret).toBe(12); // the chip's end, before the space
  });

  it("replaces a bare fragment in a tags field with the sigilled tag", () => {
    const draft = applyDraftEdit(draftFromTagField(""), "Fri").draft;
    const result = insertTagInDraft(draft, 3, "Friend");
    expect(result.draft.text).toBe("#Friend ");
    expect(chips(result.draft)).toEqual([["#Friend", "tag"]]);
  });
});

describe("snapCaret", () => {
  const draft = draftFromTagField("#Friend x");
  const spans = draft.spans; // [0,7) and [8,9)

  it("leaves a caret at a chip's edges, and outside one, alone", () => {
    expect(snapCaret(spans, 0, null)).toBe(0);
    expect(snapCaret(spans, 7, null)).toBe(7);
    expect(snapCaret(spans, 8, null)).toBe(8);
  });

  it("carries an arrow step left over the whole chip", () => {
    // ← from the chip's end lands one inside it; it must continue to the start.
    expect(snapCaret(spans, 6, 7)).toBe(0);
  });

  it("carries an arrow step right over the whole chip", () => {
    expect(snapCaret(spans, 1, 0)).toBe(7);
  });

  it("sends a click inside a chip to the nearer edge", () => {
    expect(snapCaret(spans, 2, null)).toBe(0);
    expect(snapCaret(spans, 6, null)).toBe(7);
    // A jump of more than one character is an arrival, not a step.
    expect(snapCaret(spans, 6, 20)).toBe(7);
  });

  it("returns the caret untouched when there are no chips", () => {
    expect(snapCaret([], 3, 2)).toBe(3);
  });
});

describe("snapSelection", () => {
  const spans = draftFromTagField("#Friend x").spans;

  it("snaps a collapsed selection like a caret", () => {
    expect(snapSelection(spans, { start: 6, end: 6 }, 7)).toEqual({
      start: 0,
      end: 0,
    });
  });

  it("widens a range over any chip it partly covers", () => {
    // Half of "#Friend" through the end: the whole chip comes with it, so a
    // delete can never take part of one.
    expect(snapSelection(spans, { start: 3, end: 9 }, null)).toEqual({
      start: 0,
      end: 9,
    });
  });

  it("leaves a range that covers no chip partially alone", () => {
    expect(snapSelection(spans, { start: 7, end: 8 }, null)).toEqual({
      start: 7,
      end: 8,
    });
  });
});

describe("splitDraft", () => {
  it("splits into plain, mention and tag runs that rebuild the text", () => {
    const draft = draftFromMarkup(`call ${aliceToken} about #family soon`);
    expect(splitDraft(draft).map((r) => [r.text, r.kind])).toEqual([
      ["call ", "text"],
      ["@Alice Ng", "mention"],
      [" about ", "text"],
      ["#family", "tag"],
      [" soon", "text"],
    ]);
    expect(
      splitDraft(draft)
        .map((r) => r.text)
        .join(""),
    ).toBe(draft.text);
  });

  it("returns one plain run for chipless text, and [] for empty", () => {
    expect(splitDraft(draftFromMarkup("buy milk"))).toEqual([
      { text: "buy milk", kind: "text" },
    ]);
    expect(splitDraft(draftFromMarkup(""))).toEqual([]);
  });
});
