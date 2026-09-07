import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseVCards } from "../src/index.js";
import type { ParsedContact, ParsedPartialDate } from "../src/index.js";

/**
 * Every spelling of a date a contact file can carry, read back.
 *
 * These fixtures are **also importable into a real Contacts app**, and that is
 * the point of them: `plans/export.md` → *Writing dates* decides how the
 * exporter writes dates, and it decided on measurement — the same 16 cards
 * imported into iOS Contacts on 2026-09-07 — rather than on what the RFC says.
 * This file guards the half a test can reach (what *we* read); `fixtures/
 * build-dates.mjs` documents how to re-run the half it cannot (what Apple
 * reads), which is the half that actually settled the format.
 *
 * The two results that shaped the exporter:
 *
 * - **`BDAY:--0412` works on iOS**, so the standards-correct spelling is safe
 *   and Apple's `X-APPLE-OMIT-YEAR` placeholder is never written. That matters
 *   because the placeholder's failure mode is a person recorded as born in 1604
 *   — see the note on `parseDateValue`.
 * - **`ANNIVERSARY` is ignored by iOS entirely**, even carrying a full valid
 *   date, so every dated milestone is written as Apple's `X-ABDATE` +
 *   `X-ABLABEL` pair instead. We still *read* `ANNIVERSARY`, for files other
 *   apps wrote.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** The fixture's cards, keyed by the case name each one carries. */
function cards(file: string): Map<string, ParsedContact> {
  const parsed = parseVCards(readFileSync(join(FIXTURES, file), "utf8"));
  return new Map(parsed.map((c) => [c.name.lastName, c]));
}

/** A partial date as `year-month-day`, with `--` for a part the card omitted. */
function show(date: ParsedPartialDate | null): string {
  if (date === null) return "absent";
  const part = (v: number | null) => (v === null ? "--" : String(v));
  return `${part(date.year)}-${part(date.month)}-${part(date.day)}`;
}

describe.each([
  ["dates-v3.vcf", "3.0"],
  ["dates-v4.vcf", "4.0"],
])("%s (vCard %s)", (file) => {
  const byCase = cards(file);

  // The controls. A full date in either legal spelling — extended `1985-04-12`
  // and basic `19850412` — is the same date, and if these ever disagree the
  // fixture is being misread before any of the interesting cases matter.
  it.each(["01-control-full-extended", "02-control-full-basic"])(
    "%s reads the year",
    (name) => {
      expect(show(byCase.get(name)?.birthday ?? null)).toBe("1985-4-12");
    },
  );

  // The question the exporter turns on: all three spellings of "April 12, year
  // unknown" must come back with `year: null` — including Apple's, whose whole
  // trick is a real-looking year that has to be stripped again.
  it.each([
    ["03-noyear-basic", "BDAY:--0412"],
    ["04-noyear-extended", "BDAY:--04-12"],
    ["05-noyear-apple", "BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-12"],
  ])("%s (%s) drops the year and keeps the day", (name) => {
    expect(show(byCase.get(name)?.birthday ?? null)).toBe("---4-12");
  });

  // Apple's labelled-date pair is the shape every dated milestone is exported
  // as, so it has to survive the round trip in both date spellings.
  it.each(["06-abdate-noyear-basic", "07-abdate-noyear-apple"])(
    "%s becomes a year-less anniversary, not a birthday",
    (name) => {
      const card = byCase.get(name);
      expect(card?.birthday ?? null).toBeNull();
      expect(card?.dates.map((d) => `${d.kind} ${show(d.date)}`)).toEqual([
        "anniversary ---4-12",
      ]);
    },
  );
});

describe("ANNIVERSARY is read but never written", () => {
  const byCase = cards("dates-v4.vcf");

  // iOS ignores this property, which is why the exporter does not emit it. Our
  // reader still has to accept it: a file some standards-respecting app wrote
  // is exactly the file a user switching *to* Leapsake arrives with.
  it.each([
    ["08-anniversary-noyear-basic", "---4-12"],
    ["09-anniversary-full", "1985-4-12"],
  ])("%s still imports here", (name, expected) => {
    expect(byCase.get(name)?.dates.map((d) => show(d.date))).toEqual([
      expected,
    ]);
  });
});
