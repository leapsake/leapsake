import { describe, expect, it } from "vitest";
import type { ExportContact } from "../src/index.js";
import { formatPartialDate, parseVCards, writeVCards } from "../src/index.js";

const PROD_ID = "-//Leapsake//Leapsake 0.1.0//EN";

const write = (contacts: ExportContact[]): string =>
  writeVCards(contacts, { prodId: PROD_ID });

/** A minimal round-trippable contact; override any field per test. */
function contact(over: Partial<ExportContact> = {}): ExportContact {
  return {
    uid: null,
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
 * The contact as the parser can currently report it back.
 *
 * `UID` and `CATEGORIES` are written but not yet *read* — the first is in the
 * parser's `STRUCTURAL` set, the second falls to `dropped` — so a literal
 * `parseVCards(write(x)) ≡ x` cannot hold for them until `plans/export.md`
 * increment 5 lands. Everything else is compared as-is, and the two deferred
 * fields have golden-text tests of their own below, so nothing here is merely
 * assumed to work.
 *
 * **When increment 5 lands, delete this helper** and compare `x` directly — the
 * test failing at that point is the signal that it is no longer needed.
 */
function asParsedToday(c: ExportContact): ExportContact {
  return {
    ...c,
    uid: null,
    tags: [],
    dropped:
      c.tags.length === 0
        ? c.dropped
        : [...c.dropped, { property: "CATEGORIES", value: c.tags.join(",") }],
  };
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
   * The guard `plans/export.md` asks for by name. Apple's "no year" convention
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

  it("writes an unmapped label as its own TYPE, and reads it back", () => {
    const text = write([
      contact({ phones: [phone({ label: "Mum's place" })] }),
    ]);
    expect(text).toContain("TEL;TYPE=Mum's place:");
    expectRoundTrip([contact({ phones: [phone({ label: "Mum's place" })] })]);
  });

  it("quotes a label only when a separator forces it", () => {
    const text = write([
      contact({ phones: [phone({ label: "Beach, house" })] }),
    ]);
    expect(text).toContain('TEL;TYPE="Beach, house":');
    expectRoundTrip([contact({ phones: [phone({ label: "Beach, house" })] })]);
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

describe("writeVCards — the fields the parser cannot read back yet", () => {
  /**
   * `UID` and `CATEGORIES` are increment 1 output and increment 5 input. Golden
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
