import type { CivilDate } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  type HolidayRecurrence,
  type ResolvableHoliday,
  canonicalRecurrenceJson,
  createHolidayResolver,
  isoFromCivil,
  parseRecurrence,
  westernEaster,
} from "../src/index.js";

/** Resolve one standalone rule (no derivation edges) to ISO strings. */
function isosFor(rule: HolidayRecurrence, year: number): string[] {
  const resolver = createHolidayResolver([{ slug: "x", recurrence: rule }]);
  return resolver.occurrencesFor("x", year).map(isoFromCivil);
}

/** Build a resolver over a small graph, for the derivation cases. */
function graph(
  entries: readonly ResolvableHoliday[],
  strict = false,
): ReturnType<typeof createHolidayResolver> {
  return createHolidayResolver(entries, { strict });
}

describe("fixed", () => {
  it("resolves an ordinary date", () => {
    expect(isosFor({ type: "fixed", month: 12, day: 25 }, 2026)).toEqual([
      "2026-12-25",
    ]);
  });

  it("skips Feb 29 in a common year by default", () => {
    const leapDay: HolidayRecurrence = { type: "fixed", month: 2, day: 29 };
    expect(isosFor(leapDay, 2024)).toEqual(["2024-02-29"]);
    expect(isosFor(leapDay, 2025)).toEqual([]);
  });

  it("clamps Feb 29 when the rule asks it to", () => {
    // The milestone convention (a birthday still wants to be wished); opt-in
    // here rather than global, because a holiday that only exists every four
    // years should not be invented on the 28th.
    const clamped: HolidayRecurrence = {
      type: "fixed",
      month: 2,
      day: 29,
      onInvalidDate: "clamp",
    };
    expect(isosFor(clamped, 2025)).toEqual(["2025-02-28"]);
  });
});

describe("nth-weekday", () => {
  it("resolves the nth occurrence", () => {
    // Thanksgiving 2024 — 4th Thursday in November.
    expect(
      isosFor({ type: "nth-weekday", month: 11, weekday: 4, nth: 4 }, 2024),
    ).toEqual(["2024-11-28"]);
    // Labor Day 2024 — 1st Monday in September.
    expect(
      isosFor({ type: "nth-weekday", month: 9, weekday: 1, nth: 1 }, 2024),
    ).toEqual(["2024-09-02"]);
    // Mother's Day 2024 — 2nd Sunday in May.
    expect(
      isosFor({ type: "nth-weekday", month: 5, weekday: 0, nth: 2 }, 2024),
    ).toEqual(["2024-05-12"]);
    // Father's Day 2024 — 3rd Sunday in June.
    expect(
      isosFor({ type: "nth-weekday", month: 6, weekday: 0, nth: 3 }, 2024),
    ).toEqual(["2024-06-16"]);
  });

  it("resolves `nth: -1` as the last occurrence", () => {
    // Memorial Day 2024 — last Monday in May, which is the 5th Monday.
    expect(
      isosFor({ type: "nth-weekday", month: 5, weekday: 1, nth: -1 }, 2024),
    ).toEqual(["2024-05-27"]);
    // …and 2025, where the last Monday is only the 4th.
    expect(
      isosFor({ type: "nth-weekday", month: 5, weekday: 1, nth: -1 }, 2025),
    ).toEqual(["2025-05-26"]);
  });

  it("yields nothing when the month has no such occurrence", () => {
    // February 2024 has only four Mondays, so there is no 5th.
    expect(
      isosFor({ type: "nth-weekday", month: 2, weekday: 1, nth: 5 }, 2024),
    ).toEqual([]);
  });
});

describe("computed — western easter", () => {
  it("matches known Gregorian dates", () => {
    expect(isoFromCivil(westernEaster(2024))).toBe("2024-03-31");
    expect(isoFromCivil(westernEaster(2025))).toBe("2025-04-20");
    expect(isoFromCivil(westernEaster(2026))).toBe("2026-04-05");
    // The latest Easter can ever fall — the awkward end of the computus.
    expect(isoFromCivil(westernEaster(2038))).toBe("2038-04-25");
  });

  it("resolves through the rule", () => {
    expect(
      isosFor({ type: "computed", algorithm: "western-easter" }, 2025),
    ).toEqual(["2025-04-20"]);
  });
});

describe("offset", () => {
  const easterGraph: ResolvableHoliday[] = [
    {
      slug: "western-easter",
      recurrence: { type: "computed", algorithm: "western-easter" },
    },
    {
      slug: "western-good-friday",
      recurrence: { type: "offset", from: "western-easter", days: -2 },
    },
  ];

  it("shifts from its base", () => {
    const r = graph(easterGraph);
    const goodFriday = (year: number) =>
      r.occurrencesFor("western-good-friday", year).map(isoFromCivil);
    expect(goodFriday(2024)).toEqual(["2024-03-29"]);
    expect(goodFriday(2025)).toEqual(["2025-04-18"]);
    expect(goodFriday(2038)).toEqual(["2038-04-23"]);
  });

  it("finds an occurrence shifted backwards across a year boundary", () => {
    // Base on Jan 1; two days earlier lands in the *previous* year, so
    // resolving 2024 must have searched its base in 2025.
    const r = graph([
      { slug: "base", recurrence: { type: "fixed", month: 1, day: 1 } },
      { slug: "eve", recurrence: { type: "offset", from: "base", days: -2 } },
    ]);
    expect(r.occurrencesFor("eve", 2024).map(isoFromCivil)).toEqual([
      "2024-12-30",
    ]);
  });

  it("finds an occurrence shifted forwards across a year boundary", () => {
    // Base on Dec 31; two days later lands in the *next* year, so resolving
    // 2025 must have searched its base in 2024.
    const r = graph([
      { slug: "base", recurrence: { type: "fixed", month: 12, day: 31 } },
      { slug: "after", recurrence: { type: "offset", from: "base", days: 2 } },
    ]);
    expect(r.occurrencesFor("after", 2025).map(isoFromCivil)).toEqual([
      "2025-01-02",
    ]);
  });

  it("yields nothing when its base is missing, and does not throw", () => {
    // Reachable in production: sync applies rows one at a time across batches,
    // so a derived holiday can arrive before the entry it derives from.
    const r = graph([
      {
        slug: "orphan",
        recurrence: { type: "offset", from: "gone", days: -2 },
      },
    ]);
    expect(r.occurrencesFor("orphan", 2026)).toEqual([]);
  });

  it("throws on a missing base in strict mode", () => {
    const r = graph(
      [
        {
          slug: "orphan",
          recurrence: { type: "offset", from: "gone", days: -2 },
        },
      ],
      true,
    );
    expect(() => r.occurrencesFor("orphan", 2026)).toThrow(/unknown slug/);
  });
});

describe("derivation cycles", () => {
  const cyclic: ResolvableHoliday[] = [
    { slug: "a", recurrence: { type: "offset", from: "b", days: 1 } },
    { slug: "b", recurrence: { type: "offset", from: "a", days: 1 } },
  ];

  it("degrades to no occurrences rather than hanging", () => {
    // Two independently-valid edits on two devices can assemble a cycle that
    // neither device ever authored, so this must never throw at runtime.
    expect(graph(cyclic).occurrencesFor("a", 2026)).toEqual([]);
  });

  it("throws in strict mode, so an authoring bug fails in CI", () => {
    expect(() => graph(cyclic, true).occurrencesFor("a", 2026)).toThrow(
      /cycle/,
    );
  });
});

describe("table", () => {
  const rule: HolidayRecurrence = {
    type: "table",
    dates: ["2026-12-05", "2027-12-25"],
  };

  it("returns the dates for the requested year only", () => {
    expect(isosFor(rule, 2026)).toEqual(["2026-12-05"]);
    expect(isosFor(rule, 2027)).toEqual(["2027-12-25"]);
  });

  it("stops producing occurrences past its horizon rather than guessing", () => {
    // The honest degradation research §2.8 asks for: no date beats a wrong date.
    expect(isosFor(rule, 2040)).toEqual([]);
  });

  it("can return two occurrences in one Gregorian year", () => {
    // Ramadan did this in 1997; it is why every rule answers with an array and
    // why a holiday reminder keys on the occurrence date, not the year.
    expect(
      isosFor({ type: "table", dates: ["1997-01-10", "1997-12-31"] }, 1997),
    ).toEqual(["1997-01-10", "1997-12-31"]);
  });
});

describe("parseRecurrence", () => {
  it("round-trips every rule shape through its canonical form", () => {
    const rules: HolidayRecurrence[] = [
      { type: "fixed", month: 12, day: 25, onInvalidDate: "skip" },
      { type: "nth-weekday", month: 11, weekday: 4, nth: 4 },
      { type: "computed", algorithm: "western-easter" },
      { type: "computed", algorithm: "orthodox-easter" },
      { type: "offset", from: "western-easter", days: -2 },
      { type: "table", dates: ["2026-12-05"] },
    ];
    for (const rule of rules) {
      expect(parseRecurrence(canonicalRecurrenceJson(rule))).toEqual(rule);
    }
  });

  it("returns null for a rule type this build does not know", () => {
    // Rule-type skew: data syncs, code does not. The row must survive so this
    // device can still relay it; only its occurrences are lost.
    expect(
      parseRecurrence('{"type":"hebrew-calendar","year":5786}'),
    ).toBeNull();
  });

  it("returns null rather than throwing on malformed input", () => {
    for (const bad of [
      "not json",
      "null",
      "[]",
      '"a string"',
      '{"type":"fixed","month":13,"day":1}',
      '{"type":"fixed","month":12}',
      '{"type":"nth-weekday","month":11,"weekday":9,"nth":4}',
      '{"type":"nth-weekday","month":11,"weekday":4,"nth":0}',
      // An algorithm no build implements yet. This slot used to hold
      // "orthodox-easter", which has since shipped — so it had to be replaced
      // rather than deleted: the case it covers is a rule written by a *newer*
      // build, and that case needs a name this build genuinely does not know.
      '{"type":"computed","algorithm":"coptic-easter"}',
      '{"type":"offset","from":"","days":1}',
      '{"type":"table","dates":["2026-13-05"]}',
      '{"type":"table","dates":[42]}',
    ]) {
      expect(parseRecurrence(bad)).toBeNull();
    }
  });

  it("yields no occurrences for an unparseable rule", () => {
    const r = graph([{ slug: "unknown", recurrence: null }]);
    expect(r.occurrencesFor("unknown", 2026)).toEqual([]);
  });
});

describe("canonicalRecurrenceJson", () => {
  it("emits sorted keys and no whitespace", () => {
    expect(
      canonicalRecurrenceJson({
        type: "nth-weekday",
        month: 11,
        weekday: 4,
        nth: 4,
      }),
    ).toBe('{"month":11,"nth":4,"type":"nth-weekday","weekday":4}');
  });

  it("writes the onInvalidDate default explicitly", () => {
    // Whole-row LWW tie-breaks on serialized bytes, so an omitted default and an
    // explicit one must not produce two different strings for one rule — that
    // would flap between devices forever.
    const omitted = canonicalRecurrenceJson({
      type: "fixed",
      month: 12,
      day: 25,
    });
    const explicit = canonicalRecurrenceJson({
      type: "fixed",
      month: 12,
      day: 25,
      onInvalidDate: "skip",
    });
    expect(omitted).toBe(explicit);
    expect(omitted).toBe(
      '{"day":25,"month":12,"onInvalidDate":"skip","type":"fixed"}',
    );
  });
});

describe("upcomingOccurrences", () => {
  const today: CivilDate = { year: 2026, month: 12, day: 20 };

  it("spans the year boundary", () => {
    const r = graph([
      { slug: "nye", recurrence: { type: "fixed", month: 1, day: 1 } },
    ]);
    expect(r.upcomingOccurrences("nye", today, 30).map(isoFromCivil)).toEqual([
      "2027-01-01",
    ]);
  });

  it("excludes occurrences outside the horizon", () => {
    const r = graph([
      { slug: "nye", recurrence: { type: "fixed", month: 1, day: 1 } },
    ]);
    expect(r.upcomingOccurrences("nye", today, 5)).toEqual([]);
  });

  it("includes an occurrence falling today", () => {
    const r = graph([
      { slug: "solstice", recurrence: { type: "fixed", month: 12, day: 20 } },
    ]);
    expect(
      r.upcomingOccurrences("solstice", today, 30).map(isoFromCivil),
    ).toEqual(["2026-12-20"]);
  });

  it("excludes an occurrence just gone, unless asked to look back", () => {
    const r = graph([
      { slug: "solstice", recurrence: { type: "fixed", month: 12, day: 18 } },
    ]);
    // Default: the past is out of scope, exactly as before the parameter existed.
    expect(r.upcomingOccurrences("solstice", today, 30)).toEqual([]);
    // With a lookback, a missed occasion is still offered — the reminder engine
    // needs it to keep a missed errand on the list for a day or two.
    expect(
      r.upcomingOccurrences("solstice", today, 30, 2).map(isoFromCivil),
    ).toEqual(["2026-12-18"]);
    // Still bounded: three days back is one too many.
    expect(r.upcomingOccurrences("solstice", today, 30, 1)).toEqual([]);
  });

  it("looks back across the year boundary", () => {
    // The trap: on New Year's Day, a Christmas three days gone lives in the
    // *previous* year, so a walk starting at `today.year` loses it entirely.
    const r = graph([
      { slug: "christmas", recurrence: { type: "fixed", month: 12, day: 25 } },
    ]);
    expect(
      r
        .upcomingOccurrences(
          "christmas",
          { year: 2027, month: 1, day: 1 },
          30,
          7,
        )
        .map(isoFromCivil),
    ).toEqual(["2026-12-25"]);
  });

  it("returns multiple occurrences soonest-first", () => {
    // Two regression guards in one. An inverted sort is invisible while only a
    // single occurrence lands in the window — callers taking `[0]` as "the next
    // one" silently get the FURTHEST date. And a year range hardcoded to
    // "this year and next" truncates any horizon over a year, returning a short
    // list that looks perfectly plausible.
    //
    // From 2026-12-20, 800 days reaches 2029-02-27, so three New Year's Days
    // fall inside the window.
    const r = graph([
      { slug: "nye", recurrence: { type: "fixed", month: 1, day: 1 } },
    ]);
    expect(r.upcomingOccurrences("nye", today, 800).map(isoFromCivil)).toEqual([
      "2027-01-01",
      "2028-01-01",
      "2029-01-01",
    ]);
  });
});
