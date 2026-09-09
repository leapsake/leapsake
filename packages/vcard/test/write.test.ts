import { type RelationshipRole, roleDefs } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import type {
  DroppedField,
  ExportContact,
  ParsedDate,
  ParsedRelated,
} from "../src/index.js";
import {
  dateKindFor,
  formatPartialDate,
  parseVCards,
  writeVCards,
} from "../src/index.js";

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
    name: { firstName: "Jane", middleName: null, lastName: "Doe" },
    displayName: "Jane Doe",
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
 * The contact as the parser can currently report it back — **the ledger of
 * everything the writer says that the reader cannot yet hear.**
 *
 * A literal `parseVCards(write(x)) ≡ x` cannot hold while `plans/export.md`
 * → 5 is outstanding, and the gaps are not one kind of thing:
 *
 * - `UID`, `KIND` and `REV` are in the parser's `STRUCTURAL` set and
 *   `X-LEAPSAKE-SELF`/`-CREATED` in its `DEFERRED` set, so they vanish silently.
 * - `CATEGORIES` and a `RELATED` pointing at another card fall to `dropped`.
 * - A milestone kind with no `DATE_KINDS` entry is dropped **by name**, so nine
 *   of the ten kinds we write come back as `Date (Wedding)` and friends.
 * - A relationship role **degrades**: `mother` is written as the standard
 *   `TYPE=parent` (with the exact role in a parameter the parser ignores), so it
 *   reads back as `parent`; a role with no RFC word at all reads back as `other`
 *   carrying the word.
 *
 * Each of those has a golden-text test of its own below, so nothing here is
 * merely assumed. **When increment 5 lands, delete this helper** and compare `x`
 * directly — the test failing at that point is the signal it is no longer needed.
 */
function asParsedToday(c: ExportContact): ExportContact {
  const dropped: DroppedField[] = [...c.dropped];
  // In card order, which is the order the parser walks and therefore the order
  // `toEqual` compares: CATEGORIES, then the dates, then the relationships.
  if (c.tags.length > 0) {
    dropped.push({ property: "CATEGORIES", value: c.tags.join(",") });
  }

  const dates: ParsedDate[] = [];
  for (const d of c.dates) {
    const value = formatPartialDate(d.date);
    if (value === null) continue; // never written at all
    const kind = dateKindFor(d.label);
    if (kind === null) {
      dropped.push({ property: `Date (${d.label})`, value });
      continue;
    }
    dates.push({
      kind,
      label: d.label,
      date: d.date,
      note: null,
      id: null,
      relationshipId: null,
    });
  }

  const relations: ParsedRelated[] = [];
  for (const r of c.related) {
    if (r.otherUid !== null) {
      dropped.push({ property: "RELATED", value: `urn:uuid:${r.otherUid}` });
      continue;
    }
    relations.push({
      name: r.name,
      ...degradedRole(r),
      otherUid: null,
      relationshipId: null,
    });
  }

  return {
    ...c,
    uid: null,
    kind: "individual",
    isSelf: false,
    createdAt: null,
    updatedAt: null,
    tags: [],
    dates,
    related: relations,
    dropped,
  };
}

/**
 * What a role becomes after the writer's `TYPE` goes through `relatedFrom`.
 *
 * Deliberately re-derived here from the *parser's* rules rather than imported
 * from the writer: a helper that shared the writer's table would agree with it
 * by construction and prove nothing.
 */
const RFC_WORDS: Record<string, RelationshipRole> = {
  spouse: "spouse",
  child: "child",
  parent: "parent",
  sibling: "sibling",
  friend: "friend",
  neighbor: "neighbor",
  "co-worker": "coworker",
};

/** `relatedFrom` lower-cases every TYPE and treats OTHER as noise, so a note that
 *  is either of those comes back as the bare word "related". */
function asNote(type: string | null): string {
  const lower = (type ?? "").toLowerCase();
  return lower === "" || lower === "other" ? "related" : lower;
}

function degradedRole(r: ParsedRelated): {
  role: RelationshipRole;
  roleNote: string | null;
} {
  if (r.role === "other") {
    return { role: "other", roleNote: asNote(r.roleNote) };
  }
  const base = roleDefs[r.role].base;
  const token = base === "coworker" ? "co-worker" : base;
  const known = RFC_WORDS[token];
  return known !== undefined
    ? { role: known, roleNote: null }
    : { role: "other", roleNote: asNote(token) };
}

/** The assertion the package is named for: writing then reading is the identity. */
function expectRoundTrip(contacts: ExportContact[]): void {
  expect(parseVCards(write(contacts))).toEqual(contacts.map(asParsedToday));
}

describe("writeVCards — card structure", () => {
  it("writes one well-formed 4.0 card per contact", () => {
    const text = write([contact(), contact({ displayName: "Bob Roberts" })]);
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
        name: { firstName: "Jane", middleName: "Marie", lastName: "Doe" },
      }),
    ]);
    expect(text).toContain("N:Doe;Jane;Marie;;\r\n");
  });

  it("round-trips names, including the parts a card leaves empty", () => {
    expectRoundTrip([
      contact({
        name: { firstName: "Jane", middleName: "Marie", lastName: "Doe" },
      }),
      contact({
        name: { firstName: "Cher", middleName: null, lastName: "" },
        displayName: "Cher",
      }),
      // Surname only — the case that caught `deriveName` duplicating a lone FN
      // token into both slots.
      contact({
        name: { firstName: "", middleName: null, lastName: "Smith" },
        displayName: "Smith",
      }),
    ]);
  });

  it("composes FN from the parts when the contact has no display name", () => {
    const text = write([
      contact({
        name: { firstName: "Jane", middleName: "Marie", lastName: "Doe" },
        displayName: null,
      }),
    ]);
    expect(text).toContain("FN:Jane Marie Doe\r\n");
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
          lastName: "O'Doe; Jr",
        },
        displayName: "Jane, the ; one O'Doe; Jr",
      }),
    ]);
  });

  it("round-trips a backslash without doubling it", () => {
    expectRoundTrip([
      contact({
        name: { firstName: "A\\B", middleName: null, lastName: "Doe" },
        displayName: "A\\B Doe",
      }),
    ]);
  });

  it("round-trips non-ASCII", () => {
    expectRoundTrip([
      contact({
        name: { firstName: "Zoë", middleName: null, lastName: "Ångström" },
        displayName: "Zoë Ångström",
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
        name: { firstName: emoji, middleName: null, lastName: "Doe" },
        displayName: `${emoji} Doe`,
      }),
    ]);
    // A replacement char anywhere means a sequence was cut.
    expect(text).not.toContain("�");
    expectRoundTrip([
      contact({
        name: { firstName: emoji, middleName: null, lastName: "Doe" },
        displayName: `${emoji} Doe`,
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
    // The user id is write-only until increment 5, so the round trip drops it.
    expect(parseVCards(text)[0].socials[0]).toMatchObject({
      platform: "instagram",
      handle: "janedoe",
      url: "https://www.instagram.com/janedoe",
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
      contact({ displayName: "Sam Roe", dates: [shared] }),
      contact({ displayName: "Jen Roe", dates: [shared] }),
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

  it("round-trips the one kind the parser has a label for", () => {
    expectRoundTrip([
      contact({ dates: [date({ kind: "anniversary", label: "Anniversary" })] }),
    ]);
  });
});

describe("writeVCards — relationships", () => {
  it("names an unpublished person, and points at a published one", () => {
    const text = unfolded([
      contact({
        related: [
          related({ name: "Jen Davis", role: "spouse" }),
          related({
            name: "Ben Doe",
            role: "child",
            otherUid: "cccccccc-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
          }),
        ],
      }),
    ]);
    expect(text).toContain("RELATED;VALUE=text;TYPE=spouse;");
    expect(text).toContain(":Jen Davis\r\n");
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
   * with the exact role beside it in a parameter for increment 5 to read back.
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
          related({ name: "Ben", role: "child" }),
          related({ name: "Ann", role: "friend" }),
          related({ name: "Sue", role: "coworker" }),
        ],
      }),
    ]);
  });

  it("records what a degraded role does on the way back", () => {
    expectRoundTrip([
      contact({
        related: [
          related({ role: "mother" }),
          related({ name: "Ann", role: "cousin" }),
        ],
      }),
    ]);
  });
});

describe("writeVCards — pets", () => {
  it("writes a pet card as KIND:x-pet, with its owner as a RELATED", () => {
    const text = unfolded([
      contact({
        kind: "pet",
        name: { firstName: "Rex", middleName: null, lastName: "" },
        displayName: "Rex",
        related: [
          related({
            name: "Jane Doe",
            role: "owner",
            otherUid: "eeeeeeee-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
          }),
        ],
      }),
    ]);
    expect(text).toContain("KIND:x-pet\r\n");
    expect(text).toContain("FN:Rex\r\n");
    expect(text).toContain("N:;Rex;;;\r\n");
    expect(text).toContain("TYPE=owner");
  });

  it("writes KIND:individual for a person", () => {
    expect(write([contact()])).toContain("KIND:individual\r\n");
  });
});

describe("writeVCards — the fields the parser cannot read back yet", () => {
  /**
   * `UID` and `CATEGORIES` are writer output and, still, unread input. Golden
   * text is the only assertion available until then, and the second half of each
   * test records what re-importing our own file does today — which is the
   * concrete reason not to point a desktop user at their own export yet.
   */
  it("writes the person id as a UID urn, which parses back as absent", () => {
    const id = "9f1c4b3e-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
    const text = write([contact({ uid: id })]);
    expect(text).toContain(`UID:urn:uuid:${id}`);
    expect(parseVCards(text)[0].uid).toBeNull();
  });

  it("writes tags as CATEGORIES, which parse back as a dropped field", () => {
    const text = write([contact({ tags: ["Family", "Work"] })]);
    expect(text).toContain("CATEGORIES:Family,Work\r\n");
    const back = parseVCards(text)[0];
    expect(back.tags).toEqual([]);
    expect(back.dropped).toContainEqual({
      property: "CATEGORIES",
      value: "Family,Work",
    });
  });

  it("escapes a comma inside a tag so the list keeps its shape", () => {
    const text = write([contact({ tags: ["Smith, family"] })]);
    expect(text).toContain("CATEGORIES:Smith\\, family\r\n");
  });

  /**
   * `X-LEAPSAKE-SELF` and `X-LEAPSAKE-CREATED` are the only two facts increment
   * 2 writes that have no property to ride as a parameter, so they are
   * properties of their own — which means the parser has to be told to ignore
   * them, or a user re-importing their own file would see them listed as fields
   * that could not be imported. That is what the `DEFERRED` set is for, and this
   * is the test that it works.
   */
  it("writes self and created-at as properties the parser ignores in silence", () => {
    const text = write([
      contact({ isSelf: true, createdAt: Date.UTC(2024, 2, 9, 1, 35, 0) }),
    ]);
    expect(text).toContain("X-LEAPSAKE-SELF:TRUE\r\n");
    expect(text).toContain("X-LEAPSAKE-CREATED:2024-03-09T01:35:00Z\r\n");
    const back = parseVCards(text)[0];
    expect(back.isSelf).toBe(false);
    expect(back.createdAt).toBeNull();
    expect(back.dropped).toEqual([]);
  });

  it("writes REV, which is structural and vanishes on the way back", () => {
    const text = write([
      contact({ updatedAt: Date.UTC(2026, 8, 7, 12, 0, 0) }),
    ]);
    expect(text).toContain("REV:2026-09-07T12:00:00Z\r\n");
    expect(parseVCards(text)[0].updatedAt).toBeNull();
  });

  it("writes a pet's KIND, which is structural and reads back as a person", () => {
    const text = write([contact({ kind: "pet" })]);
    expect(text).toContain("KIND:x-pet\r\n");
    // Apple Contacts imports such a card as an ordinary person, and so do we
    // until increment 5 takes `KIND` out of `STRUCTURAL`. Accepted: nothing is
    // lost, and it is recorded here rather than discovered later.
    expect(parseVCards(text)[0].kind).toBe("individual");
  });

  it("writes the nine kinds with no DATE_KINDS entry, which drop by name", () => {
    const text = write([
      contact({ dates: [date({ kind: "wedding", label: "Wedding" })] }),
    ]);
    expect(text).toContain("item1.X-ABLABEL:Wedding\r\n");
    expect(parseVCards(text)[0].dropped).toContainEqual({
      property: "Date (Wedding)",
      value: "2011-06-18",
    });
  });

  it("writes a published RELATED as a urn, which drops as a reference", () => {
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
    handle: "janedoe",
    url: "https://www.instagram.com/janedoe",
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
    name: "Jen Davis",
    role: "spouse",
    roleNote: null,
    otherUid: null,
    relationshipId: null,
    ...over,
  };
}
