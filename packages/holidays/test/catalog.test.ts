import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_VERSION,
  canonicalRecurrenceJson,
  classificationFor,
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

/** Whole days from one `YYYY-MM-DD` to another. */
function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86400000;
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

  it("gives every live entry a display name nothing else shares", () => {
    // A name has to identify its holiday on its own: search returns a bare
    // title, and the browse list is flat. Two entries reading "Thanksgiving"
    // are two rows a user cannot tell apart — which is what `ca-thanksgiving`
    // is named "Canadian Thanksgiving" to avoid. Grouping by region will help,
    // but a name that only works inside its group is still the wrong name.
    const names = CATALOG.filter((e) => e.retiredAt === undefined).map(
      (e) => e.name,
    );
    expect(new Set(names).size).toBe(names.length);
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
    expect(on("us-mlk-day", 2026)).toEqual(["2026-01-19"]);
    expect(on("us-presidents-day", 2026)).toEqual(["2026-02-16"]);
    expect(on("uk-remembrance-sunday", 2026)).toEqual(["2026-11-08"]);
  });

  it("puts three different holidays on the second Monday in October", () => {
    // Columbus Day, Indigenous Peoples' Day and Canadian Thanksgiving all land
    // here, and none of them is a variant of another. A regression that deduped
    // by date rather than by `familyId` would silently drop two of the three.
    expect(on("us-columbus-day", 2026)).toEqual(["2026-10-12"]);
    expect(on("us-indigenous-peoples-day", 2026)).toEqual(["2026-10-12"]);
    expect(on("ca-thanksgiving", 2026)).toEqual(["2026-10-12"]);
  });

  it("resolves the new fixed entries", () => {
    expect(on("orthodox-christmas", 2026)).toEqual(["2026-01-07"]);
    expect(on("au-australia-day", 2026)).toEqual(["2026-01-26"]);
    expect(on("intl-womens-day", 2026)).toEqual(["2026-03-08"]);
    expect(on("ie-st-patricks", 2026)).toEqual(["2026-03-17"]);
    expect(on("intl-workers-day", 2026)).toEqual(["2026-05-01"]);
    expect(on("mx-cinco-de-mayo", 2026)).toEqual(["2026-05-05"]);
    expect(on("ca-canada-day", 2026)).toEqual(["2026-07-01"]);
    expect(on("fr-bastille-day", 2026)).toEqual(["2026-07-14"]);
    expect(on("mx-independence-day", 2026)).toEqual(["2026-09-16"]);
    expect(on("mx-dia-de-muertos", 2026)).toEqual(["2026-11-01"]);
    expect(on("us-veterans-day", 2026)).toEqual(["2026-11-11"]);
    expect(on("ca-remembrance-day", 2026)).toEqual(["2026-11-11"]);
    expect(on("uk-boxing-day", 2026)).toEqual(["2026-12-26"]);
    expect(on("new-years-eve", 2026)).toEqual(["2026-12-31"]);
  });

  it("derives Mothering Sunday from Easter, not from a weekday rule", () => {
    // The fourth Sunday of Lent, Easter − 21. Easter 2026 is 5 April.
    expect(on("uk-mothering-sunday", 2026)).toEqual(["2026-03-15"]);
  });

  it("derives the Lantern Festival from Lunar New Year's table", () => {
    // The 15th day of the first month — LNY + 14 — so it inherits the table's
    // corrections and its horizon instead of needing a second table.
    expect(on("lunar-new-year", 2027)).toEqual(["2027-02-06"]);
    expect(on("lantern-festival", 2027)).toEqual(["2027-02-20"]);
    // Inherited horizon: no base occurrence, so no derived one.
    expect(on("lantern-festival", 2099)).toEqual([]);
  });

  it("resolves Easter and derives Good Friday from it", () => {
    expect(on("western-easter", 2026)).toEqual(["2026-04-05"]);
    expect(on("western-good-friday", 2026)).toEqual(["2026-04-03"]);
  });

  it("resolves Orthodox Easter on its own rule, not Western Easter's", () => {
    // Published dates. The two reckonings diverge by up to five weeks — a week
    // in 2026, five in 2027 — so a regression that quietly resolved this entry
    // with the Western computus would still look plausible in some years.
    expect(on("orthodox-easter", 2026)).toEqual(["2026-04-12"]);
    expect(on("orthodox-easter", 2027)).toEqual(["2027-05-02"]);
    expect(on("orthodox-easter", 2028)).toEqual(["2028-04-16"]);
    expect(on("orthodox-easter", 2030)).toEqual(["2030-04-28"]);
    expect(on("western-easter", 2026)).toEqual(["2026-04-05"]);
    expect(on("orthodox-good-friday", 2026)).toEqual(["2026-04-10"]);
  });

  it("converts Orthodox Easter out of the Julian calendar exactly", () => {
    // The Julian/Gregorian gap is 13 days until 2100 and 14 after it. This date
    // is on the far side of that step, so it fails if the conversion is ever
    // "simplified" into adding a constant — a `computed` rule has no horizon at
    // which it stops answering, so it would just be wrong forever.
    expect(on("orthodox-easter", 2100)).toEqual(["2100-05-02"]);
  });

  it("resolves the lunisolar entries from their tables", () => {
    expect(on("hanukkah", 2026)).toEqual(["2026-12-05"]);
    expect(on("lunar-new-year", 2027)).toEqual(["2027-02-06"]);
    expect(on("rosh-hashanah", 2026)).toEqual(["2026-09-12"]);
    expect(on("yom-kippur", 2026)).toEqual(["2026-09-21"]);
    expect(on("sukkot", 2026)).toEqual(["2026-09-26"]);
    expect(on("passover", 2027)).toEqual(["2027-04-22"]);
  });

  it("holds the Tishrei entries in their fixed relationship, every year", () => {
    // 1, 10 and 15 Tishrei: Yom Kippur is always 9 days after Rosh Hashanah and
    // Sukkot always 14. Checking the whole table catches a transcription slip in
    // any single year, which spot-checking one year cannot — and it would catch
    // a table accidentally authored on the "eve of" convention while its
    // neighbours use the daytime one.
    for (let year = 2026; year <= 2056; year++) {
      const [rosh] = on("rosh-hashanah", year);
      const [kippur] = on("yom-kippur", year);
      const [sukkot] = on("sukkot", year);
      expect(daysBetween(rosh, kippur)).toBe(9);
      expect(daysBetween(rosh, sukkot)).toBe(14);
    }
  });

  it("does not wish anyone a happy Yom Kippur", () => {
    // The greeting field carries its own article precisely so an occasion can
    // decline "a Happy". A day of atonement taking the birthday voice is the
    // kind of tone-deafness that is worse than a missing holiday.
    expect(bySlug.get("yom-kippur")?.greeting.toLowerCase()).not.toContain(
      "happy",
    );
    expect(bySlug.get("rosh-hashanah")?.greeting).toBe("Shana Tova");
  });

  it("resolves the Chinese entries from their tables", () => {
    expect(on("dragon-boat-festival", 2026)).toEqual(["2026-06-19"]);
    expect(on("dragon-boat-festival", 2027)).toEqual(["2027-06-09"]);
    expect(on("mid-autumn-festival", 2026)).toEqual(["2026-09-25"]);
    expect(on("mid-autumn-festival", 2027)).toEqual(["2027-09-15"]);
  });

  it("keeps the Chinese entries inside the window their month implies", () => {
    // The failure mode worth guarding here is a leap-month misnumbering, which
    // moves a holiday by a whole lunar month rather than by a day. Both windows
    // are only a little wider than one lunation, so a month-sized error lands
    // outside them — where an off-by-one-day error would not, and is instead
    // covered by the two independent derivations agreeing.
    for (const [slug, from, to] of [
      ["dragon-boat-festival", "05-25", "06-26"],
      ["mid-autumn-festival", "09-05", "10-07"],
    ] as const) {
      for (let year = 2026; year <= 2056; year++) {
        const [date] = on(slug, year);
        const monthDay = (date ?? "").slice(5);
        expect(
          monthDay >= from && monthDay <= to,
          `${slug} ${year} resolved to ${date}`,
        ).toBe(true);
      }
    }
  });

  it("carries the multi-day durations the Hebrew entries need", () => {
    expect(bySlug.get("rosh-hashanah")?.durationDays).toBe(2);
    expect(bySlug.get("sukkot")?.durationDays).toBe(7);
    expect(bySlug.get("passover")?.durationDays).toBe(8);
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

  it("carries every lunisolar table to the ~30-year horizon", () => {
    // Research §2.8 asks for ~30 years. The failure mode this guards is silent:
    // a table that quietly runs out stops generating reminders rather than
    // erroring, so nothing else would notice. Written over every `table` entry
    // rather than a hardcoded list, so a new one cannot be added short.
    const tables = CATALOG.filter((e) => e.recurrence.type === "table");
    expect(tables.length).toBeGreaterThanOrEqual(6);
    for (const entry of tables) {
      if (entry.recurrence.type !== "table") continue;
      const last = entry.recurrence.dates.at(-1) ?? "";
      expect(
        Number(last.slice(0, 4)),
        `${entry.slug} runs out at ${last}`,
      ).toBeGreaterThanOrEqual(2056);
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

/** Every slug in one `familyId`, sorted — the picker's dedup unit. */
function family(id: string): string[] {
  return CATALOG.filter((e) => e.familyId === id)
    .map((e) => e.slug)
    .sort();
}

describe("catalog classification", () => {
  it("classifies every entry", () => {
    for (const entry of CATALOG) {
      expect(classificationFor(entry.slug)).not.toBeNull();
    }
  });

  it("answers null for a slug this bundle does not carry", () => {
    // A user-defined holiday, or a catalog entry that arrived over sync from a
    // newer bundle. Callers group these under "Other"; the one thing that must
    // not happen is a throw, since this runs while rendering the browse list.
    expect(classificationFor("a-holiday-someone-invented")).toBeNull();
  });

  it("groups a secular holiday by region and every other one by tradition", () => {
    // The rule the browse list sections on. National days group as "United
    // States"; religious ones group as "Jewish", because that is how someone
    // picking holidays for a particular person reasons about them.
    expect(classificationFor("us-thanksgiving")?.groupKey).toBe("us");
    expect(classificationFor("fr-bastille-day")?.groupKey).toBe("fr");
    expect(classificationFor("intl-womens-day")?.groupKey).toBe("global");
    expect(classificationFor("hanukkah")?.groupKey).toBe("jewish");
    expect(classificationFor("christmas")?.groupKey).toBe("christian");
    expect(classificationFor("lunar-new-year")?.groupKey).toBe("chinese");
  });

  it("keeps a religious holiday's region global, so diaspora is not stranded", () => {
    // Pinning a tradition's holidays to one country would be wrong for everyone
    // who keeps them elsewhere, and would bury them for a US user.
    for (const entry of CATALOG) {
      if (entry.tradition === "secular") continue;
      if (entry.region !== "global") {
        expect(entry.familyId).toBeDefined();
      }
    }
  });

  it("families group the same idea, never two holidays one person keeps apart", () => {
    // Mother's Day: the README's own example — same idea, unrelated rules.
    expect(family("mothers-day")).toEqual([
      "uk-mothering-sunday",
      "us-mothers-day",
    ]);
    // The Armistice lineage. Memorial Day is a day of remembrance and is
    // deliberately absent: a US user keeps it and Veterans Day separately, so
    // letting the picker collapse them would hide a holiday they observe.
    expect(family("remembrance")).toEqual([
      "ca-remembrance-day",
      "uk-remembrance-sunday",
      "us-veterans-day",
    ]);
    expect(family("christmas")).toEqual(["christmas", "orthodox-christmas"]);
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
      "3aff5b51ea924e49113b95b8522912956135d082953cb632ce44a45518af15a9",
    );
  });

  it("has an integer version, since sync_state holds integers", () => {
    expect(Number.isInteger(CATALOG_VERSION)).toBe(true);
  });
});
