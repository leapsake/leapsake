import { describe, expect, it } from "vitest";
import type { ExportContact, ParsedDate, ParsedRelated } from "../src/index.js";
import { kindDefs, milestoneKindSchema } from "@leapsake/schema";
import {
  dateKindFor,
  formatPartialDate,
  parseVCards,
  writeVCards,
} from "../src/index.js";

/** Every kind Leapsake has, so a round-trip test cannot miss a new one. */
const milestoneKinds = milestoneKindSchema.options;

const PROD_ID = "-//Leapsake//Leapsake 0.1.0//EN";

const write = (contacts: ExportContact[]): string =>
  writeVCards(contacts, { prodId: PROD_ID });

/**
 * The same text with the folds taken out, for asserting on a line longer than
 * 75 octets. A `RELATED` carrying two uuids is well past that, and a golden
 * assertion that happened to straddle a fold would fail for a reason that has
 * nothing to do with what it is testing. Folding has tests of its own.
 */
const unfolded = (contacts: ExportContact[]): string =>
  write(contacts).replace(/\r\n /g, "");

/** A minimal round-trippable contact; override any field per test. */
function contact(over: Partial<ExportContact> = {}): ExportContact {
  return {
    uid: null,
    kind: "individual",
    isSelf: false,
    createdAt: null,
    updatedAt: null,
    name: { firstName: "Jane", middleName: null, lastName: "Wainwright" },
    displayName: "Jane Wainwright",
    gender: null,
    emails: [],
    phones: [],
    postals: [],
    socials: [],
    birthday: null,
    dates: [],
    related: [],
    tags: [],
    dropped: [],
    ...over,
  };
}

/**
 * The contact as the parser reports it back — **what is left of the ledger of
 * everything the writer says that the reader cannot hear.**
 *
 * ⚠️ **This is the end state, not a gap.** What remains is the one thing that
 * can never leave, so **do not try to delete it**:
 *
 * - `writeParam` strips `"` and folds newlines to a space, because vCard's
 *   parameter grammar has an escape for neither — so a multi-line milestone note
 *   riding `X-LEAPSAKE-MILESTONE-NOTE` is *knowingly* not byte-exact.
 * - A milestone with no date at all is not written, since an `X-ABDATE` with an
 *   empty value is a line saying nothing.
 *
 * Note what is **not** here any more: nothing about `DATE_KINDS`. Our own cards
 * carry `X-LEAPSAKE-MILESTONE-KIND`, so the round trip needs no label guessing —
 * which is exactly why 5d is about *other people's* cards alone, and why
 * widening that map cannot be validated from this file.
 */
function asParsedToday(c: ExportContact): ExportContact {
  const dates: ParsedDate[] = [];
  for (const d of c.dates) {
    if (formatPartialDate(d.date) === null) continue; // never written at all
    dates.push({ ...d, note: normalisedNote(d.note) });
  }

  return { ...c, dates };
}

/** A note as the parameter grammar can carry it: no `"`, no line breaks. */
function normalisedNote(note: string | null): string | null {
  return note === null ? null : note.replace(/"/g, "").replace(/[\r\n]+/g, " ");
}

/** The assertion the package is named for: writing then reading is the identity. */
function expectRoundTrip(contacts: ExportContact[]): void {
  expect(parseVCards(write(contacts))).toEqual(contacts.map(asParsedToday));
}

describe("writeVCards — card structure", () => {
  it("writes one well-formed 4.0 card per contact", () => {
    const text = write([contact(), contact({ displayName: "Harry Welch" })]);
    expect(text.match(/BEGIN:VCARD/g)).toHaveLength(2);
    expect(text.match(/END:VCARD/g)).toHaveLength(2);
    expect(text).toContain("VERSION:4.0");
    expect(text).toContain(`PRODID:${PROD_ID}`);
    // CRLF everywhere: a bare LF is the thing a strict consumer rejects.
    expect(text.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(
      true,
    );
    expect(text.endsWith("END:VCARD\r\n")).toBe(true);
  });

  it("writes N with all five components, so nothing shifts on the way back", () => {
    const text = write([
      contact({
        name: {
          firstName: "Mary",
          middleName: "Hatch",
          lastName: "Bailey",
        },
      }),
    ]);
    expect(text).toContain("N:Bailey;Mary;Hatch;;\r\n");
  });

  it("round-trips names, including the parts a card leaves empty", () => {
    expectRoundTrip([
      contact({
        name: {
          firstName: "Mary",
          middleName: "Hatch",
          lastName: "Bailey",
        },
      }),
      contact({
        name: { firstName: "Zuzu", middleName: null, lastName: "" },
        displayName: "Zuzu",
      }),
      // Surname only — the case that caught `deriveName` duplicating a lone FN
      // token into both slots.
      contact({
        name: { firstName: "", middleName: null, lastName: "Martini" },
        displayName: "Martini",
      }),
    ]);
  });

  it("composes FN from the parts when the contact has no display name", () => {
    const text = write([
      contact({
        name: {
          firstName: "Mary",
          middleName: "Hatch",
          lastName: "Bailey",
        },
        displayName: null,
      }),
    ]);
    expect(text).toContain("FN:Mary Hatch Bailey\r\n");
  });

  it("round-trips every gender, and writes none for null", () => {
    expectRoundTrip([
      contact({ gender: "male" }),
      contact({ gender: "female" }),
      contact({ gender: "nonbinary" }),
    ]);
    expect(write([contact({ gender: null })])).not.toContain("GENDER");
  });
});

describe("writeVCards — escaping and folding", () => {
  it("round-trips a name holding the two characters vCard separates on", () => {
    expectRoundTrip([
      contact({
        name: {
          firstName: "Jane, the ; one",
          middleName: null,
          lastName: "O'Wainwright; Jr",
        },
        displayName: "Jane, the ; one O'Wainwright; Jr",
      }),
    ]);
  });

  it("round-trips a backslash without doubling it", () => {
    expectRoundTrip([
      contact({
        name: { firstName: "A\\B", middleName: null, lastName: "Wainwright" },
        displayName: "A\\B Wainwright",
      }),
    ]);
  });

  it("round-trips non-ASCII", () => {
    expectRoundTrip([
      contact({
        name: { firstName: "Nicolò", middleName: null, lastName: "Martini" },
        displayName: "Nicolò Martini",
      }),
    ]);
  });

  it("folds at 75 octets, and every continuation is one space", () => {
    const long = "x".repeat(300);
    const text = write([
      contact({ emails: [{ label: "Home", address: `${long}@example.com` }] }),
    ]);
    for (const line of text.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(text).toMatch(/\r\n x/);
  });

  it("never folds mid-UTF-8-sequence", () => {
    // Astral-plane characters are 4 octets each, so a naive character-count fold
    // lands inside one and produces two halves no decoder can rejoin.
    const emoji = "🎂".repeat(60);
    const text = write([
      contact({
        name: { firstName: emoji, middleName: null, lastName: "Wainwright" },
        displayName: `${emoji} Wainwright`,
      }),
    ]);
    // A replacement char anywhere means a sequence was cut.
    expect(text).not.toContain("�");
    expectRoundTrip([
      contact({
        name: { firstName: emoji, middleName: null, lastName: "Wainwright" },
        displayName: `${emoji} Wainwright`,
      }),
    ]);
  });

  it("round-trips a 300-character value through the fold", () => {
    const note = "Sûre, why not; commas, too: ".repeat(12).slice(0, 300);
    expectRoundTrip([
      contact({ socials: [social({ handle: note, url: null })] }),
    ]);
  });
});

describe("writeVCards — dates", () => {
  it("writes a full date in extended form", () => {
    expect(formatPartialDate({ year: 1985, month: 4, day: 12 })).toBe(
      "1985-04-12",
    );
  });

  it("writes a year-less date as --0412, basic and separator-free", () => {
    expect(formatPartialDate({ year: null, month: 4, day: 12 })).toBe("--0412");
  });

  it("writes the partial cases the milestone schema allows", () => {
    expect(formatPartialDate({ year: 1985, month: 4, day: null })).toBe(
      "1985-04",
    );
    expect(formatPartialDate({ year: 1985, month: null, day: null })).toBe(
      "1985",
    );
    expect(
      formatPartialDate({ year: null, month: null, day: null }),
    ).toBeNull();
  });

  /**
   * The guard `../README.md` asks for by name. Apple's "no year" convention
   * writes a placeholder year into the value (`1604`) and names it in a
   * parameter — which any consumer that does not know the parameter reads as a
   * person born in 1604: data invented silently, attached to a real person, and
   * synced onward. This is exactly what a later "improve Apple compatibility"
   * change reintroduces, so it fails here rather than on someone's phone.
   */
  it("never emits a placeholder year or X-APPLE-OMIT-YEAR", () => {
    const text = write([
      contact({ birthday: { year: null, month: 4, day: 12 } }),
    ]);
    expect(text).toContain("BDAY:--0412");
    expect(text).not.toContain("X-APPLE-OMIT-YEAR");
    expect(text).not.toContain("1604");
  });

  it("round-trips a birthday with and without a year", () => {
    expectRoundTrip([
      contact({ birthday: { year: 1985, month: 4, day: 12 } }),
      contact({ birthday: { year: null, month: 4, day: 12 } }),
    ]);
  });
});

describe("writeVCards — contact methods", () => {
  it("round-trips emails and phones with their labels", () => {
    expectRoundTrip([
      contact({
        emails: [
          { label: "Home", address: "jane@home.example" },
          { label: "Work", address: "jane@work.example" },
        ],
        phones: [
          phone({ label: "Mobile", number: "+1 555 100" }),
          phone({ label: "Main", number: "+1 555 300" }),
        ],
      }),
    ]);
  });

  /**
   * Increment 1 wrote a custom label as the `TYPE` value (`TYPE=Mum's place`).
   * That round-trips through us, but iOS Contacts does not read it, so the one
   * platform v0.1 ships to showed the number as untyped. Apple's own form is the
   * grouped `X-ABLABEL`, which our parser already reads and which round-trips
   * **exactly** rather than title-cased.
   */
  it("writes a custom label as Apple's grouped X-ABLABEL", () => {
    const c = contact({ phones: [phone({ label: "Mum's place" })] });
    const text = write([c]);
    expect(text).toContain("item1.TEL:+1 555 100\r\n");
    expect(text).toContain("item1.X-ABLABEL:Mum's place\r\n");
    expect(text).not.toContain("TYPE=Mum's place");
    expectRoundTrip([c]);
  });

  it("keeps a comma in a custom label without quoting a value", () => {
    const c = contact({ phones: [phone({ label: "Beach, house" })] });
    const text = write([c]);
    // A property *value* escapes its commas; only a param would need quoting,
    // and the label is no longer a param.
    expect(text).toContain("item1.X-ABLABEL:Beach\\, house\r\n");
    expectRoundTrip([c]);
  });

  it("mixes standard and custom labels without colliding groups", () => {
    const text = write([
      contact({
        phones: [
          phone({ label: "Mobile" }),
          phone({ label: "Mum's place", number: "+1 555 200" }),
          phone({ label: "Dad's place", number: "+1 555 300" }),
        ],
      }),
    ]);
    expect(text).toContain("TEL;TYPE=CELL:+1 555 100\r\n");
    expect(text).toContain("item1.X-ABLABEL:Mum's place\r\n");
    expect(text).toContain("item2.X-ABLABEL:Dad's place\r\n");
  });

  it("writes no TYPE for the Other label, which reads back as Other", () => {
    const text = write([contact({ phones: [phone({ label: "Other" })] })]);
    expect(text).toContain("TEL:+1 555 100\r\n");
    expectRoundTrip([contact({ phones: [phone({ label: "Other" })] })]);
  });

  it("spells a non-SMS phone as TYPE=FAX, the flag's own definition inverted", () => {
    const text = write([
      contact({ phones: [phone({ label: "Fax", smsCapable: false })] }),
    ]);
    expect(text).toContain("TEL;TYPE=FAX:");
    // One TYPE=FAX, not two: the label already said it.
    expect(text.match(/FAX/g)).toHaveLength(1);
    expectRoundTrip([
      contact({ phones: [phone({ label: "Fax", smsCapable: false })] }),
    ]);
  });

  it("keeps a labelled non-SMS number's label and its fax-ness apart", () => {
    // Two TYPEs on one property: `CELL` carries the label, `FAX` the flag. The
    // parser takes the first *known* type as the label and derives the flag from
    // whether FAX is present anywhere, so both survive.
    const c = contact({
      phones: [phone({ label: "Mobile", smsCapable: false })],
    });
    expect(write([c])).toContain("TEL;TYPE=CELL;TYPE=FAX:");
    expectRoundTrip([c]);
  });

  it("carries an extension and a country as params on the TEL", () => {
    const text = write([
      contact({ phones: [phone({ extension: "204", country: "GB" })] }),
    ]);
    expect(text).toContain("X-LEAPSAKE-EXT=204");
    expect(text).toContain("X-LEAPSAKE-COUNTRY=GB");
  });

  /**
   * The single easiest thing in the writer to get wrong. `ADR` is
   * `PO Box; Extended; Street; Locality; Region; Postal; Country`, so `line1`
   * is the *street* slot and `line2` the *extended* one — the inverse of the
   * order `mapAddress` falls back through when reading. Written the other way
   * round, every address round-trips shifted by one field and nothing fails
   * loudly, which is why this asserts the literal component positions rather
   * than only the round trip.
   */
  it("puts line1 in the street slot and line2 in the extended slot", () => {
    const text = write([contact({ postals: [postal()] })]);
    expect(text).toContain(
      "ADR;TYPE=HOME:;Apt 4;1 Main St;Springfield;IL;62704;",
    );
    expectRoundTrip([contact({ postals: [postal()] })]);
  });

  it("writes the ISO country as a grouped X-ABADR, never in ADR's own slot", () => {
    const text = write([contact({ postals: [postal({ country: "US" })] })]);
    expect(text).toContain("item1.ADR;TYPE=HOME:");
    expect(text).toContain("item1.X-ABADR:US");
    // The free-text country component stays empty — a name in a locale we would
    // have to invent is not something `countryCode` will accept back.
    expect(text).toContain(";62704;\r\n");
    expectRoundTrip([contact({ postals: [postal({ country: "US" })] })]);
  });

  it("groups two countried addresses separately", () => {
    const text = write([
      contact({
        postals: [
          postal({ country: "US" }),
          postal({ label: "Work", country: "GB" }),
        ],
      }),
    ]);
    expect(text).toContain("item1.X-ABADR:US");
    expect(text).toContain("item2.X-ABADR:GB");
  });

  /**
   * An address can need a group for two independent reasons at once. Allocating
   * one apiece would separate the address from its own country — the `X-ABADR`
   * would name a group holding nothing but a label — and `countryCode` would
   * find no hint. One group, three lines.
   */
  it("puts a custom-labelled address, its label and its country in one group", () => {
    const c = contact({
      postals: [postal({ label: "Beach house", country: "US" })],
    });
    const text = write([c]);
    expect(text).toContain("item1.ADR:;Apt 4;1 Main St;Springfield;IL;62704;");
    expect(text).toContain("item1.X-ABLABEL:Beach house\r\n");
    expect(text).toContain("item1.X-ABADR:US\r\n");
    expect(text).not.toContain("item2.");
    expectRoundTrip([c]);
  });

  it("round-trips a social profile, with its platform and user id", () => {
    const text = write([
      contact({ socials: [social({ platformUserId: "1234567" })] }),
    ]);
    expect(text).toContain("X-SERVICE-TYPE=instagram");
    expect(text).toContain("X-LEAPSAKE-USERID=1234567");
    expect(parseVCards(text)[0].socials[0]).toMatchObject({
      platform: "instagram",
      handle: "janewainwright",
      url: "https://www.instagram.com/janewainwright",
      // Unrecoverable from the handle, which is why it gets a parameter at all.
      platformUserId: "1234567",
    });
  });
});

describe("writeVCards — milestones", () => {
  it("writes a dated milestone as Apple's X-ABDATE + X-ABLABEL pair", () => {
    const text = write([contact({ dates: [date({ label: "Wedding" })] })]);
    expect(text).toContain("item1.X-ABDATE");
    expect(text).toContain(":2011-06-18\r\n");
    expect(text).toContain("item1.X-ABLABEL:Wedding\r\n");
  });

  /**
   * The measured reason the whole table hangs off `X-ABDATE`. Both `ANNIVERSARY`
   * probes — including one carrying an ordinary full date — produced *no field
   * at all* in iOS Contacts, so writing an anniversary the standards-correct way
   * loses it silently on the one platform v0.1 ships to.
   * `../README.md` → *Two rules that point in opposite directions*.
   */
  it("never writes ANNIVERSARY, which iOS ignores entirely", () => {
    const text = write([
      contact({ dates: [date({ kind: "anniversary", label: "Anniversary" })] }),
    ]);
    expect(text).not.toContain("ANNIVERSARY");
    expect(text).toContain("X-ABDATE");
  });

  it("carries the kind, id and note as params on the date they belong to", () => {
    const text = unfolded([
      contact({
        dates: [
          date({
            kind: "graduation",
            label: "Graduation",
            id: "9f2c4b3e-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
            note: "summa cum laude",
          }),
        ],
      }),
    ]);
    expect(text).toContain("X-LEAPSAKE-MILESTONE-KIND=graduation");
    expect(text).toContain(
      "X-LEAPSAKE-MILESTONE-ID=9f2c4b3e-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
    );
    expect(text).toContain("X-LEAPSAKE-MILESTONE-NOTE=summa cum laude");
  });

  /**
   * A wedding is stored on the marriage, not on either partner, so it is written
   * on both cards with **one** id. Without the shared id an importer would have
   * no way to tell one anniversary written twice from two anniversaries.
   */
  it("marks a relationship-borne date with its relationship, on both cards", () => {
    const shared = date({
      label: "Wedding",
      id: "aaaaaaaa-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
      relationshipId: "bbbbbbbb-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
    });
    const text = unfolded([
      contact({ displayName: "Ernie Bailey", dates: [shared] }),
      contact({ displayName: "Ruth Bailey", dates: [shared] }),
    ]);
    expect(
      text.match(
        /X-LEAPSAKE-MILESTONE-REL=bbbbbbbb-1c4b-4f2a-9d3e-6a7b8c9d0e1f/g,
      ),
    ).toHaveLength(2);
    expect(
      text.match(
        /X-LEAPSAKE-MILESTONE-ID=aaaaaaaa-1c4b-4f2a-9d3e-6a7b8c9d0e1f/g,
      ),
    ).toHaveLength(2);
  });

  /**
   * A note is multi-line free text and a vCard parameter is `QSAFE-CHAR`, which
   * excludes control characters — a raw newline would end the line and turn the
   * rest of the property into a continuation of nothing.
   */
  it("folds a newline in a note to a space rather than breaking the line", () => {
    const text = unfolded([
      contact({ dates: [date({ note: "first line\nsecond line" })] }),
    ]);
    expect(text).toContain("X-LEAPSAKE-MILESTONE-NOTE=first line second line");
    for (const line of text.split("\r\n")) {
      expect(line).not.toContain("\n");
    }
  });

  it("skips a milestone with no date at all", () => {
    const text = write([
      contact({
        dates: [date({ date: { year: null, month: null, day: null } })],
      }),
    ]);
    expect(text).not.toContain("X-ABDATE");
  });

  /**
   * **All ten kinds, as of 5c.** The label is whatever a human would read in
   * Contacts; the kind rides beside it, so none of them depends on `DATE_KINDS`
   * having heard of that label. Before the parameter was read, nine of these ten
   * came back as dropped fields.
   */
  it("round-trips every milestone kind, label map or not", () => {
    expectRoundTrip(
      milestoneKinds.map((kind) =>
        contact({ dates: [date({ kind, label: kindDefs[kind].label })] }),
      ),
    );
  });

  it("round-trips a note, an id and the relationship that bears the date", () => {
    expectRoundTrip([
      contact({
        dates: [
          date({
            kind: "wedding",
            label: "Wedding",
            id: "aaaaaaaa-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
            relationshipId: "bbbbbbbb-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
            note: "at the lighthouse",
          }),
        ],
      }),
    ]);
  });

  /**
   * Kind `other` wears the user's own note as its label, which is why the writer
   * omits `-NOTE` when the two are equal — and why the parser has to put it back
   * from the label rather than reporting a note the card does not spell twice.
   */
  it("recovers an other-kind note from the label the writer left it as", () => {
    const text = unfolded([
      contact({
        dates: [
          date({
            kind: "other",
            label: "Beach house closing",
            note: "Beach house closing",
          }),
        ],
      }),
    ]);
    expect(text).not.toContain("X-LEAPSAKE-MILESTONE-NOTE");
    expect(parseVCards(text)[0].dates[0]).toMatchObject({
      kind: "other",
      label: "Beach house closing",
      note: "Beach house closing",
    });
  });

  /**
   * A store holding two birthday-kind milestones exports the first as `BDAY` and
   * the second as a "Birthday"-labelled `X-ABDATE`. The parameter is what stops
   * the second being swallowed by the label rule that exists for foreign cards —
   * see the `X-ABDATE` case in `vcard.ts`.
   */
  it("keeps a second birthday-kind milestone apart from the card's BDAY", () => {
    expectRoundTrip([
      contact({
        birthday: { year: 1992, month: 3, day: 9 },
        dates: [
          date({
            kind: "birthday",
            label: "Birthday",
            date: { year: 1992, month: 3, day: 10 },
          }),
        ],
      }),
    ]);
  });

  /** The one gap that outlives every increment: see {@link asParsedToday}. */
  it("does not round-trip a note's newlines, knowingly", () => {
    const text = write([
      contact({ dates: [date({ note: "first line\nsecond line" })] }),
    ]);
    expect(parseVCards(text)[0].dates[0].note).toBe("first line second line");
  });
});

describe("writeVCards — relationships", () => {
  it("names an unpublished person, and points at a published one", () => {
    const text = unfolded([
      contact({
        related: [
          related({ name: "Ruth Dakin", role: "spouse" }),
          related({
            name: "Pete Wainwright",
            role: "child",
            otherUid: "cccccccc-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
          }),
        ],
      }),
    ]);
    expect(text).toContain("RELATED;VALUE=text;TYPE=spouse;");
    expect(text).toContain(":Ruth Dakin\r\n");
    expect(text).toContain("RELATED;VALUE=uri;TYPE=child;");
    expect(text).toContain(
      ":urn:uuid:cccccccc-1c4b-4f2a-9d3e-6a7b8c9d0e1f\r\n",
    );
  });

  it("carries the edge's id, so both halves name one relationship", () => {
    const text = unfolded([
      contact({
        related: [
          related({ relationshipId: "dddddddd-1c4b-4f2a-9d3e-6a7b8c9d0e1f" }),
        ],
      }),
    ]);
    expect(text).toContain(
      "X-LEAPSAKE-REL-ID=dddddddd-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
    );
  });

  /**
   * Leapsake has 41 roles and RFC 6350 gives us seven words. A gendered variant
   * goes out as its base — which is what a standards consumer can actually use —
   * with the exact role beside it in a parameter our own reader prefers.
   * Writing `TYPE=mother` instead would tell a third party nothing *and* lose the
   * kinship through our own parser.
   */
  it("writes a gendered role as its standard base, keeping the exact role", () => {
    const text = write([contact({ related: [related({ role: "mother" })] })]);
    expect(text).toContain("TYPE=parent");
    expect(text).toContain("X-LEAPSAKE-ROLE=mother");
    expect(text).not.toContain("TYPE=mother");
  });

  it("writes coworker as RFC 6350's own co-worker", () => {
    const text = write([contact({ related: [related({ role: "coworker" })] })]);
    expect(text).toContain("TYPE=co-worker");
  });

  it("writes a role with no RFC word as itself", () => {
    const text = write([contact({ related: [related({ role: "cousin" })] })]);
    expect(text).toContain("TYPE=cousin");
    expect(text).toContain("X-LEAPSAKE-ROLE=cousin");
  });

  /**
   * Bare, not `x-<note>`: `relatedFrom` turns an unmapped type into exactly the
   * word it read, so `TYPE=muse` round-trips to "muse" while `x-muse` would
   * round-trip to the literal string "x-muse".
   */
  it("writes an other-role's note as the bare TYPE, which round-trips exactly", () => {
    const c = contact({
      related: [related({ role: "other", roleNote: "muse" })],
    });
    expect(write([c])).toContain("TYPE=muse");
    expectRoundTrip([c]);
  });

  it("round-trips the roles RFC 6350 has a word for", () => {
    expectRoundTrip([
      contact({
        related: [
          related({ role: "spouse" }),
          related({ name: "Pete", role: "child" }),
          related({ name: "Violet", role: "friend" }),
          related({ name: "Eustace", role: "coworker" }),
        ],
      }),
    ]);
  });

  /**
   * The degradation this used to record. `mother` goes out as `TYPE=parent` for
   * a standards consumer and comes back `mother` for us, because the exact role
   * rides beside it; `cousin`, which RFC 6350 has no word for at all, survives
   * the same way rather than collapsing to `other` + a note.
   */
  it("round-trips a role RFC 6350 cannot spell", () => {
    expectRoundTrip([
      contact({
        related: [
          related({ role: "mother" }),
          related({ name: "Tilly", role: "cousin" }),
          related({ name: "Mary", role: "grandmother" }),
          related({ name: "Pete", role: "pibling" }),
        ],
      }),
    ]);
  });

  it("keeps an other-role note's own casing", () => {
    // The note is the user's word, and it rides in `TYPE`, which `typesOf`
    // upper-cases for label matching — so reading it back through that would
    // hand "Muse" back as "muse".
    expectRoundTrip([
      contact({ related: [related({ role: "other", roleNote: "Muse" })] }),
    ]);
  });

  it("keeps an other-role with no note at all", () => {
    expectRoundTrip([
      contact({ related: [related({ role: "other", roleNote: null })] }),
    ]);
  });
});

describe("writeVCards — pets", () => {
  it("writes a pet card as KIND:x-pet, with its owner as a RELATED", () => {
    const text = unfolded([
      contact({
        kind: "pet",
        name: { firstName: "Jimmy", middleName: null, lastName: "" },
        displayName: "Jimmy",
        related: [
          related({
            name: "William Bailey",
            role: "owner",
            otherUid: "eeeeeeee-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
          }),
        ],
      }),
    ]);
    expect(text).toContain("KIND:x-pet\r\n");
    expect(text).toContain("FN:Jimmy\r\n");
    expect(text).toContain("N:;Jimmy;;;\r\n");
    expect(text).toContain("TYPE=owner");
  });

  it("writes KIND:individual for a person", () => {
    expect(write([contact()])).toContain("KIND:individual\r\n");
  });
});

describe("writeVCards — the card's identity, both directions", () => {
  /**
   * These six were the ledger of what our own file lost on the way back in, and
   * are now the proof it does not. Each asserts the golden text *and* the value
   * the parser recovers, because the two halves fail differently: the first
   * catches a change of spelling that would break a third-party consumer, the
   * second a reader that quietly stopped reading.
   */
  it("round-trips the entity id through the UID urn", () => {
    const id = "9f1c4b3e-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
    const text = write([contact({ uid: id })]);
    expect(text).toContain(`UID:urn:uuid:${id}`);
    expect(parseVCards(text)[0].uid).toBe(id);
  });

  it("round-trips tags through CATEGORIES", () => {
    const text = write([contact({ tags: ["Family", "Work"] })]);
    expect(text).toContain("CATEGORIES:Family,Work\r\n");
    const back = parseVCards(text)[0];
    expect(back.tags).toEqual(["Family", "Work"]);
    expect(back.dropped).toEqual([]);
  });

  it("escapes a comma inside a tag so the list keeps its shape", () => {
    const text = write([contact({ tags: ["Martini, family"] })]);
    expect(text).toContain("CATEGORIES:Martini\\, family\r\n");
    // The whole point of the escape: one tag, not two. A splitter that does not
    // know a delimiter can be escaped is what this guards against, on the read
    // side as much as the write side.
    expect(parseVCards(text)[0].tags).toEqual(["Martini, family"]);
  });

  /**
   * `X-LEAPSAKE-SELF` and `X-LEAPSAKE-CREATED` are the only two facts the writer
   * emits with no property to ride as a parameter, so they are properties of
   * their own — which is why they had to be ignored by name until the parser
   * could read them, or a user re-importing their own file would have seen their
   * own fields listed as "could not be imported". `dropped` staying empty is
   * still the assertion that matters most here.
   */
  it("round-trips self and created-at, and surfaces neither as dropped", () => {
    const text = write([
      contact({ isSelf: true, createdAt: Date.UTC(2024, 2, 9, 1, 35, 0) }),
    ]);
    expect(text).toContain("X-LEAPSAKE-SELF:TRUE\r\n");
    expect(text).toContain("X-LEAPSAKE-CREATED:2024-03-09T01:35:00Z\r\n");
    const back = parseVCards(text)[0];
    expect(back.isSelf).toBe(true);
    expect(back.createdAt).toBe(Date.UTC(2024, 2, 9, 1, 35, 0));
    expect(back.dropped).toEqual([]);
  });

  it("round-trips REV as the updated-at stamp", () => {
    const text = write([
      contact({ updatedAt: Date.UTC(2026, 8, 7, 12, 0, 0) }),
    ]);
    expect(text).toContain("REV:2026-09-07T12:00:00Z\r\n");
    expect(parseVCards(text)[0].updatedAt).toBe(Date.UTC(2026, 8, 7, 12, 0, 0));
  });

  /**
   * The six above each drive one field on an otherwise-default contact, which
   * is what makes a failure legible — but the fixture spells every identity
   * field as absent, so none of them would catch two facts interfering. This one
   * carries all six at once, through `expectRoundTrip`, which compares the whole
   * contact rather than a field.
   */
  it("round-trips every identity field at once", () => {
    expectRoundTrip([
      contact({
        uid: "9f1c4b3e-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
        kind: "pet",
        isSelf: true,
        createdAt: Date.UTC(2024, 2, 9, 1, 35, 0),
        updatedAt: Date.UTC(2026, 8, 7, 12, 0, 0),
        tags: ["Family", "Martini, family"],
      }),
    ]);
  });

  it("round-trips a pet's KIND", () => {
    const text = write([contact({ kind: "pet" })]);
    expect(text).toContain("KIND:x-pet\r\n");
    // Apple Contacts still imports such a card as an ordinary person — an
    // accepted loss, since nothing is lost by it. We no longer do.
    expect(parseVCards(text)[0].kind).toBe("pet");
  });

  /**
   * **The inversion 5c is.** Until the kind was carried outright, this very card
   * came back as a dropped `Date (Wedding)` — `DATE_KINDS` had no entry for the
   * label, and `dateKindFor` was the only thing asked. The label is still what a
   * human reads in Contacts; the parameter is what makes it exact for us.
   *
   * Deliberately asserts nothing about `DATE_KINDS`' *contents*: increment 5d
   * widens that map, and this test is about the parameter, not about it.
   */
  it("recovers the kind from the parameter, whatever the label says", () => {
    const text = write([
      contact({ dates: [date({ kind: "wedding", label: "Wedding" })] }),
    ]);
    expect(text).toContain("item1.X-ABLABEL:Wedding\r\n");
    const back = parseVCards(text)[0];
    expect(back.dropped).toEqual([]);
    expect(back.dates).toEqual([
      {
        kind: "wedding",
        label: "Wedding",
        date: { year: 2011, month: 6, day: 18 },
        note: null,
        id: null,
        relationshipId: null,
      },
    ]);
  });

  /**
   * The sharper half of the same rule, and the one that cannot rot: a card whose
   * label and parameter **disagree**. `Anniversary` is the one label
   * `DATE_KINDS` has always resolved, so this stays a real conflict however far
   * 5d widens that map — and the parameter has to win, or an `other`-kind
   * milestone could never come home at all.
   */
  it("prefers the parameter over a label that maps to a different kind", () => {
    const text = write([
      contact({ dates: [date({ kind: "wedding", label: "Anniversary" })] }),
    ]);
    expect(dateKindFor("Anniversary")).toBe("anniversary");
    expect(parseVCards(text)[0].dates[0]).toMatchObject({
      kind: "wedding",
      label: "Anniversary",
    });
  });

  /**
   * **The assertion 5b exists for.** Two cards pointing at each other by `UID`,
   * written and read as one file — which is what an export of a whole store
   * always is. Both edges come back as references with their exact roles and the
   * shared edge id intact, and each recovers the *other card's* `FN` as the name
   * a reference does not itself carry.
   */
  it("resolves a reference against the card it names, in either order", () => {
    const jane = "aaaaaaaa-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
    const pete = "bbbbbbbb-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
    const edge = "dddddddd-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
    const cards = [
      contact({
        uid: jane,
        related: [
          related({
            name: "Pete Wainwright",
            role: "son",
            otherUid: pete,
            relationshipId: edge,
          }),
        ],
      }),
      contact({
        uid: pete,
        displayName: "Pete Wainwright",
        name: { firstName: "Pete", middleName: null, lastName: "Wainwright" },
        // The reciprocal half: same edge id, the inverse role, and it points
        // *backwards* at a card the parser has not built yet when it reads this
        // one — which is the ordering the UID pre-pass exists to make irrelevant.
        related: [
          related({
            name: "Jane Wainwright",
            role: "mother",
            otherUid: jane,
            relationshipId: edge,
          }),
        ],
      }),
    ];
    expectRoundTrip(cards);

    // Spelled out, because `expectRoundTrip` passing is only as meaningful as
    // the fixture: the name really did come from the other card.
    const [backJane, backBen] = parseVCards(write(cards));
    expect(backJane.related[0]).toMatchObject({
      name: "Pete Wainwright",
      role: "son",
      otherUid: pete,
      relationshipId: edge,
    });
    expect(backBen.related[0]).toMatchObject({
      name: "Jane Wainwright",
      otherUid: jane,
    });
  });

  /**
   * A reference names a card, so it can only be read when that card is *here*.
   * One exported alone — a single contact lifted out of a file, or a partial
   * export — leaves the edge pointing at nothing, and it stays in `dropped`,
   * which is where the review already shows it as not imported.
   */
  it("drops a reference to a card this file does not contain", () => {
    const uid = "cccccccc-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
    const text = unfolded([contact({ related: [related({ otherUid: uid })] })]);
    expect(text).toContain(`:urn:uuid:${uid}\r\n`);
    const back = parseVCards(text)[0];
    expect(back.related).toEqual([]);
    expect(back.dropped).toContainEqual({
      property: "RELATED",
      value: `urn:uuid:${uid}`,
    });
  });
});

// ---------------------------------------------------------------------------

function phone(over: Partial<ExportContact["phones"][number]> = {}) {
  return {
    label: "Mobile",
    number: "+1 555 100",
    extension: null,
    country: null,
    smsCapable: true,
    ...over,
  };
}

function postal(over: Partial<ExportContact["postals"][number]> = {}) {
  return {
    label: "Home",
    line1: "1 Main St",
    line2: "Apt 4",
    locality: "Springfield",
    region: "IL",
    postalCode: "62704",
    country: null,
    ...over,
  };
}

function social(over: Partial<ExportContact["socials"][number]> = {}) {
  return {
    label: "Other",
    platform: "instagram",
    handle: "janewainwright",
    url: "https://www.instagram.com/janewainwright",
    platformUserId: null,
    ...over,
  };
}

function date(over: Partial<ParsedDate> = {}): ParsedDate {
  return {
    kind: "wedding",
    label: "Wedding",
    date: { year: 2011, month: 6, day: 18 },
    note: null,
    id: null,
    relationshipId: null,
    ...over,
  };
}

function related(over: Partial<ParsedRelated> = {}): ParsedRelated {
  return {
    name: "Ruth Dakin",
    role: "spouse",
    roleNote: null,
    otherUid: null,
    relationshipId: null,
    ...over,
  };
}
