import type { CivilDate } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  UNDATED_KEY,
  emptyDate,
  whenChoices,
  whenKeyOf,
} from "../src/headless/index.js";

const today: CivilDate = { year: 2026, month: 8, day: 20 };
const keys = (kind: "suggestion" | "giving") =>
  whenChoices(kind, today).map((c) => c.key);

describe("whenChoices", () => {
  it("looks forward for a suggestion and back for a giving", () => {
    expect(keys("suggestion")).toEqual([UNDATED_KEY, "2026", "2027"]);
    expect(keys("giving")).toEqual([UNDATED_KEY, "today", "2026", "2025"]);
  });

  it("offers an undated choice in both tenses, an occasion being an answer on its own", () => {
    for (const kind of ["suggestion", "giving"] as const) {
      const first = whenChoices(kind, today)[0];
      expect(first?.key).toBe(UNDATED_KEY);
      expect(first?.date).toEqual(emptyDate());
    }
  });

  it("sets only the year for a year, leaving month and day to the occasion", () => {
    const choice = whenChoices("suggestion", today).find(
      (c) => c.key === "2027",
    );
    expect(choice?.date).toEqual({ year: "2027", month: "", day: "" });
  });

  it("sets the whole date for today, which is the one choice that knows one", () => {
    const choice = whenChoices("giving", today).find((c) => c.key === "today");
    expect(choice?.date).toEqual({ year: "2026", month: "8", day: "20" });
  });
});

describe("whenKeyOf", () => {
  const suggestion = whenChoices("suggestion", today);
  const giving = whenChoices("giving", today);

  it("reads a blank date as the undated choice rather than as nothing", () => {
    expect(whenKeyOf(emptyDate(), suggestion)).toBe(UNDATED_KEY);
  });

  it("matches a bare year", () => {
    expect(whenKeyOf({ year: "2027", month: "", day: "" }, suggestion)).toBe(
      "2027",
    );
  });

  it("prefers today over the bare year it shares", () => {
    expect(whenKeyOf({ year: "2026", month: "8", day: "20" }, giving)).toBe(
      "today",
    );
    expect(whenKeyOf({ year: "2026", month: "", day: "" }, giving)).toBe(
      "2026",
    );
  });

  it("ignores whitespace, since these are typed fields", () => {
    expect(whenKeyOf({ year: " 2026 ", month: "", day: "" }, suggestion)).toBe(
      "2026",
    );
  });

  // The null is what opens the year/month/day disclosure, so a date the row
  // cannot say must never come back as one of its choices.
  it("gives up on a date no choice can say", () => {
    expect(
      whenKeyOf({ year: "2025", month: "12", day: "25" }, giving),
    ).toBeNull();
    // A past target: expressible for a giving, but not among a suggestion's.
    expect(
      whenKeyOf({ year: "2020", month: "", day: "" }, suggestion),
    ).toBeNull();
    // A month with no year — what a recurring intent looks like stored.
    expect(
      whenKeyOf({ year: "", month: "12", day: "25" }, suggestion),
    ).toBeNull();
  });
});
