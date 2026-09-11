import { parseBirthdayQuery } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  type HighlightSegment,
  highlightBirthdaySegments,
  highlightSegments,
} from "../src/index.js";

/** The substrings a result would render inside a `<mark>` — order preserved. */
const marked = (segs: HighlightSegment[]): string[] =>
  segs.filter((s) => s.marked).map((s) => s.text);

/** Segments must always concatenate back to the original string, losslessly. */
const joined = (segs: HighlightSegment[]): string =>
  segs.map((s) => s.text).join("");

describe("highlightSegments — text", () => {
  it("marks an accent- and case-folded match", () => {
    const segs = highlightSegments("Nicolò Martini", "nicolo", "text");
    expect(segs).toEqual([
      { text: "Nicolò", marked: true },
      { text: " Martini", marked: false },
    ]);
  });

  it("marks an interior substring", () => {
    expect(highlightSegments("Christopher", "stop", "text")).toEqual([
      { text: "Chri", marked: false },
      { text: "stop", marked: true },
      { text: "her", marked: false },
    ]);
  });

  it("marks a starts-with match", () => {
    expect(highlightSegments("Martini", "mar", "text")).toEqual([
      { text: "Mar", marked: true },
      { text: "tini", marked: false },
    ]);
  });

  it("returns one unmarked segment when nothing matches", () => {
    expect(highlightSegments("Harry", "xyz", "text")).toEqual([
      { text: "Harry", marked: false },
    ]);
  });

  it("returns the plain text for an empty term", () => {
    expect(highlightSegments("Harry", "", "text")).toEqual([
      { text: "Harry", marked: false },
    ]);
  });

  it("returns no segments for empty text", () => {
    expect(highlightSegments("", "harry", "text")).toEqual([]);
  });
});

describe("highlightSegments — phone", () => {
  it("marks the matching digits inside a formatted number", () => {
    const segs = highlightSegments("+1 (555) 123-4567", "5551234567", "phone");
    expect(segs).toEqual([
      { text: "+1 (", marked: false },
      { text: "555) 123-4567", marked: true },
    ]);
    expect(joined(segs)).toBe("+1 (555) 123-4567");
  });

  it("marks the whole value when the term contains it (extra country code)", () => {
    // "+1 555 1234" → digits "15551234" fully contains the stored "5551234".
    expect(highlightSegments("555-1234", "+1 555 1234", "phone")).toEqual([
      { text: "555-1234", marked: true },
    ]);
  });
});

describe("highlightSegments — address", () => {
  it("marks a comma/whitespace-insensitive substring", () => {
    expect(
      highlightSegments("123 Any Street, Pittsburgh", "street", "address"),
    ).toEqual([
      { text: "123 Any ", marked: false },
      { text: "Street", marked: true },
      { text: ", Pittsburgh", marked: false },
    ]);
  });

  it("spans from the first to the last matched token when reordered", () => {
    expect(
      highlightSegments(
        "123 Any Street, Pittsburgh",
        "any pittsburgh",
        "address",
      ),
    ).toEqual([
      { text: "123 ", marked: false },
      { text: "Any Street, Pittsburgh", marked: true },
    ]);
  });
});

describe("highlightBirthdaySegments — numeric", () => {
  it("marks the month word and day number for M/D", () => {
    expect(highlightBirthdaySegments("October 31, 1990", "10/31")).toEqual([
      { text: "October", marked: true },
      { text: " ", marked: false },
      { text: "31", marked: true },
      { text: ", 1990", marked: false },
    ]);
  });

  it("also marks the year for M/D/Y", () => {
    expect(highlightBirthdaySegments("October 31, 1990", "10/31/1990")).toEqual(
      [
        { text: "October", marked: true },
        { text: " ", marked: false },
        { text: "31", marked: true },
        { text: ", ", marked: false },
        { text: "1990", marked: true },
      ],
    );
  });

  it("marks only the year for a lone 4-digit year", () => {
    expect(highlightBirthdaySegments("October 31, 1990", "1990")).toEqual([
      { text: "October 31, ", marked: false },
      { text: "1990", marked: true },
    ]);
  });

  it("marks both orderings of an ambiguous M/D", () => {
    // "3/4" means March 4 *and* April 3 — each reason highlights structurally.
    expect(marked(highlightBirthdaySegments("March 4", "3/4"))).toEqual([
      "March",
      "4",
    ]);
    expect(marked(highlightBirthdaySegments("April 3", "3/4"))).toEqual([
      "April",
      "3",
    ]);
  });

  it("leaves a non-date numeric query plain", () => {
    expect(highlightBirthdaySegments("October 31, 1990", "13/40")).toEqual([
      { text: "October 31, 1990", marked: false },
    ]);
  });

  it("never marks digits inside the year as the day", () => {
    const segs = highlightBirthdaySegments("October 31, 1990", "10/31");
    expect(marked(segs)).toEqual(["October", "31"]);
  });
});

describe("highlightBirthdaySegments — month-name queries defer to text folding", () => {
  it("marks a month abbreviation", () => {
    expect(highlightBirthdaySegments("October 31, 1990", "oct")).toEqual([
      { text: "Oct", marked: true },
      { text: "ober 31, 1990", marked: false },
    ]);
  });

  it("marks a month name plus day", () => {
    expect(highlightBirthdaySegments("October 31, 1990", "october 31")).toEqual(
      [
        { text: "October 31", marked: true },
        { text: ", 1990", marked: false },
      ],
    );
  });
});

describe("birthday highlight stays in lockstep with parseBirthdayQuery", () => {
  // The structural pieces a numeric query highlights must reflect exactly which
  // date parts parseBirthdayQuery (what the service matched on) read from it —
  // month → the leading letters, day/year → digit runs. This pins the two to a
  // single source so they can't drift.
  const text = "October 31, 1990";
  const cases = ["10/31", "10/31/1990", "1990", "13/40", "99"];
  for (const term of cases) {
    it(`agrees on the parts of "${term}"`, () => {
      const candidates = parseBirthdayQuery(term);
      const wantMonth = candidates.some((c) => c.month !== undefined);
      const wantDay = candidates.some((c) => c.day !== undefined);
      const wantYear = candidates.some((c) => c.year !== undefined);

      const m = marked(highlightBirthdaySegments(text, term));
      const hasLetters = m.some((s) => /\p{L}/u.test(s));
      const has31 = m.includes("31");
      const has1990 = m.includes("1990");

      expect(hasLetters).toBe(wantMonth);
      expect(has31).toBe(wantDay);
      expect(has1990).toBe(wantYear);
    });
  }
});
