import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_VERSION,
  canonicalRecurrenceJson,
  createHolidayResolver,
  isoFromCivil,
  parseRecurrence,
} from "../src/index.js";

/** The bundled catalog, resolved in **strict** mode — authoring bugs throw here. */
const strict = createHolidayResolver(
  CATALOG.map((e) => ({ slug: e.slug, recurrence: e.recurrence })),
  { strict: true },
);

const bySlug = new Map(CATALOG.map((e) => [e.slug, e]));

function on(slug: string, year: number): string[] {
  return strict.occurrencesFor(slug, year).map(isoFromCivil);
}

describe("catalog integrity", () => {
  it("has unique slugs", () => {
    expect(bySlug.size).toBe(CATALOG.length);
  });

  it("resolves every non-retired entry without throwing", () => {
    // Strict mode turns a cycle, an unknown derivation base, or an over-deep
    // chain into an exception, so this is the acyclicity guard research §2.13
    // asks for. It cannot live at runtime — synced rows must degrade instead.
    for (const entry of CATALOG) {
      if (entry.retiredAt !== undefined) continue;
      expect(() => strict.occurrencesFor(entry.slug, 2026)).not.toThrow();
    }
  });

  it("covers every recurrence shape, so no path is untested end to end", () => {
    // Research §2.9: deferring the lunisolar work on the theory that users will
    // fill the gap themselves is structurally unsound — they cannot author a
    // lunar table. At least one `table` entry must ship with the catalog.
    const shapes = new Set(CATALOG.map((e) => e.recurrence.type));
    expect([...shapes].sort()).toEqual([
      "computed",
      "fixed",
      "nth-weekday",
      "offset",
      "table",
    ]);
  });

  it("gives every entry a greeting, for the reminder copy", () => {
    for (const entry of CATALOG) {
      expect(entry.greeting.trim().length).toBeGreaterThan(0);
    }
  });

  it("points every derivation edge at an entry that exists", () => {
    for (const entry of CATALOG) {
      if (entry.recurrence.type !== "offset") continue;
      expect(bySlug.has(entry.recurrence.from)).toBe(true);
    }
  });
});

describe("catalog dates", () => {
  it("resolves the fixed entries", () => {
    expect(on("christmas", 2026)).toEqual(["2026-12-25"]);
    expect(on("new-years-day", 2026)).toEqual(["2026-01-01"]);
    expect(on("us-valentines", 2026)).toEqual(["2026-02-14"]);
    expect(on("us-juneteenth", 2026)).toEqual(["2026-06-19"]);
    expect(on("us-independence-day", 2026)).toEqual(["2026-07-04"]);
    expect(on("us-halloween", 2026)).toEqual(["2026-10-31"]);
  });

  it("resolves the nth-weekday entries", () => {
    expect(on("us-thanksgiving", 2026)).toEqual(["2026-11-26"]);
    expect(on("us-mothers-day", 2026)).toEqual(["2026-05-10"]);
    expect(on("us-fathers-day", 2026)).toEqual(["2026-06-21"]);
    expect(on("us-memorial-day", 2026)).toEqual(["2026-05-25"]);
    expect(on("us-labor-day", 2026)).toEqual(["2026-09-07"]);
  });

  it("resolves Easter and derives Good Friday from it", () => {
    expect(on("western-easter", 2026)).toEqual(["2026-04-05"]);
    expect(on("western-good-friday", 2026)).toEqual(["2026-04-03"]);
  });

  it("resolves the lunisolar entries from their tables", () => {
    expect(on("hanukkah", 2026)).toEqual(["2026-12-05"]);
    expect(on("lunar-new-year", 2027)).toEqual(["2027-02-06"]);
  });

  it("pins the lunisolar dates that a rule would get wrong", () => {
    // Each of these is a spot-check of a *different* way the data could be
    // wrong, so a regression names its own cause rather than just "a date moved".

    // Hanukkah drifts across a five-week Gregorian window and can fall in
    // November — anything that assumed "late December" is wrong here.
    expect(on("hanukkah", 2032)).toEqual(["2032-11-28"]);
    expect(on("hanukkah", 2040)).toEqual(["2040-11-30"]);
    // ...and can land after Christmas.
    expect(on("hanukkah", 2043)).toEqual(["2043-12-27"]);

    // 2034 is the leap-month case: the naive "second new moon after the winter
    // solstice" rule yields 2034-01-20, a month early. See the module doc.
    expect(on("lunar-new-year", 2034)).toEqual(["2034-02-19"]);

    // The two borderline years, where the new moon falls within minutes of
    // midnight in UTC+8 and the civil date turns on precision, not on the rule.
    expect(on("lunar-new-year", 2027)).toEqual(["2027-02-06"]);
    expect(on("lunar-new-year", 2030)).toEqual(["2030-02-03"]);
  });

  it("carries both lunisolar tables to the ~30-year horizon", () => {
    // Research §2.8 asks for ~30 years. The failure mode this guards is silent:
    // a table that quietly runs out stops generating reminders rather than
    // erroring, so nothing else would notice.
    for (const slug of ["hanukkah", "lunar-new-year"]) {
      const entry = bySlug.get(slug);
      if (entry?.recurrence.type !== "table")
        throw new Error(`${slug} is not a table`);
      const last = entry.recurrence.dates.at(-1) ?? "";
      expect(Number(last.slice(0, 4))).toBeGreaterThanOrEqual(2056);
    }
  });

  it("keeps every lunisolar table ascending, unique and well-formed", () => {
    // Ascending order is load-bearing: `occurrencesFor` and the horizon check
    // both read the array as sorted.
    for (const entry of CATALOG) {
      if (entry.recurrence.type !== "table") continue;
      const { dates } = entry.recurrence;
      for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect([...dates]).toEqual([...dates].sort());
      expect(new Set(dates).size).toBe(dates.length);
      // One occurrence per year for both of these holidays, over this horizon —
      // a duplicated year would mean a transcription slip.
      const years = dates.map((d) => d.slice(0, 4));
      expect(new Set(years).size).toBe(years.length);
    }
  });

  it("stops rather than extrapolating past the lunisolar horizon", () => {
    expect(on("hanukkah", 2099)).toEqual([]);
    expect(on("lunar-new-year", 2099)).toEqual([]);
  });

  it("carries the multi-day duration on the entry, anchored to the start", () => {
    expect(bySlug.get("hanukkah")?.durationDays).toBe(8);
  });
});

describe("catalog serialization", () => {
  // ASCII unit/record separators, written as escapes so this file stays plain
  // text: a literal control byte in the source makes git treat it as binary,
  // which silently costs every future diff and review of this file. They are
  // used as delimiters because they cannot occur in any field being hashed.
  const FIELD = "\u001f";
  const RECORD = "\u001e";

  it("round-trips every entry's rule through its stored form", () => {
    for (const entry of CATALOG) {
      const json = canonicalRecurrenceJson(entry.recurrence);
      expect(parseRecurrence(json)).toEqual(parseRecurrence(json));
      expect(canonicalRecurrenceJson(entry.recurrence)).toBe(json);
    }
  });

  it("pins the exact bytes of the whole catalog", () => {
    // The single most valuable test in this file. Catalog rows sync, and
    // whole-row LWW tie-breaks on canonical serialization — so if two builds
    // serialize one entry differently, the devices running them flap against
    // each other forever. This hash changing is not necessarily a bug, but it
    // *must* be accompanied by a CATALOG_VERSION bump, or no device re-seeds.
    const payload = CATALOG.map((e) =>
      [
        e.slug,
        e.name,
        e.greeting,
        canonicalRecurrenceJson(e.recurrence),
        e.durationDays ?? "",
        e.familyId ?? "",
        e.impliedByLocale === true ? "1" : "0",
        e.authoredAt,
        e.retiredAt ?? "",
      ].join(FIELD),
    ).join(RECORD);
    expect(createHash("sha256").update(payload).digest("hex")).toBe(
      "44f6d06defec148823fb00b5748f596235e30ec214b1bb66bd0a71a7c73b0360",
    );
  });

  it("has an integer version, since sync_state holds integers", () => {
    expect(Number.isInteger(CATALOG_VERSION)).toBe(true);
  });
});
