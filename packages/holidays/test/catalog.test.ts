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
      "46786ffca43fc76b04579538f00f6a0cb1dc79b0aaf793531b8e64cc950182c4",
    );
  });

  it("has an integer version, since sync_state holds integers", () => {
    expect(Number.isInteger(CATALOG_VERSION)).toBe(true);
  });
});
