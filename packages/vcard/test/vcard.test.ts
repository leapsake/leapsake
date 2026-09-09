import { describe, expect, it } from "vitest";
import { detectContactFormat, parseVCards } from "../src/index.js";

/** Assemble a vCard from body lines with CRLF endings (the on-the-wire norm). */
function card(...lines: string[]): string {
  return ["BEGIN:VCARD", "VERSION:3.0", ...lines, "END:VCARD"].join("\r\n");
}

describe("detectContactFormat", () => {
  it("recognises a vCard by content signature", () => {
    expect(detectContactFormat({ text: card("FN:Jane Doe") })).toEqual({
      format: "vcard",
    });
  });

  it("recognises a vCard by .vcf extension even without the signature", () => {
    expect(
      detectContactFormat({ text: "garbled", filename: "contacts.VCF" }),
    ).toEqual({ format: "vcard" });
  });

  it("tolerates a leading BOM before the signature", () => {
    expect(detectContactFormat({ text: `﻿${card("FN:Jo")}` })).toEqual({
      format: "vcard",
    });
  });

  it("returns unknown for anything else", () => {
    expect(
      detectContactFormat({
        text: "name,email\nJo,jo@x.com",
        filename: "c.csv",
      }),
    ).toEqual({ format: "unknown" });
  });
});

describe("parseVCards — names", () => {
  it("maps a structured N into first/middle/last", () => {
    const [c] = parseVCards(card("N:Doe;Jane;Marie;;", "FN:Jane Doe"));
    expect(c.name).toEqual({
      firstName: "Jane",
      middleName: "Marie",
      lastName: "Doe",
    });
    expect(c.displayName).toBe("Jane Doe");
  });

  it("falls back to splitting FN when N has no given name", () => {
    const [c] = parseVCards(card("FN:Jane Q Doe"));
    expect(c.name).toEqual({
      firstName: "Jane",
      middleName: null,
      lastName: "Q Doe",
    });
  });

  it("leaves lastName empty for a mononym / org-only card (never fabricated)", () => {
    const [c] = parseVCards(card("FN:Acme"));
    expect(c.name).toEqual({
      firstName: "Acme",
      middleName: null,
      lastName: "",
    });
  });
});

describe("parseVCards — contact methods", () => {
  it("maps EMAIL/TEL/ADR with TYPE labels", () => {
    const [c] = parseVCards(
      card(
        "N:Doe;Jane;;;",
        "EMAIL;TYPE=INTERNET,HOME:jane@home.example",
        "EMAIL;TYPE=WORK:jane@work.example",
        "TEL;TYPE=CELL:+1 555 100",
        "TEL;TYPE=FAX:555 200",
        "ADR;TYPE=HOME:;;1 Main St;Springfield;IL;62704;US",
      ),
    );
    expect(c.emails).toEqual([
      { label: "Home", address: "jane@home.example" },
      { label: "Work", address: "jane@work.example" },
    ]);
    expect(c.phones).toEqual([
      {
        label: "Mobile",
        number: "+1 555 100",
        extension: null,
        country: null,
        smsCapable: true,
      },
      {
        label: "Fax",
        number: "555 200",
        extension: null,
        country: null,
        smsCapable: false,
      },
    ]);
    expect(c.postals).toEqual([
      {
        label: "Home",
        line1: "1 Main St",
        line2: null,
        locality: "Springfield",
        region: "IL",
        postalCode: "62704",
        country: "US",
      },
    ]);
  });

  it("drops a free-text ADR country rather than corrupting the ISO field", () => {
    const [c] = parseVCards(
      card("FN:Jane Doe", "ADR:;;1 Main St;Town;;;United States"),
    );
    expect(c.postals[0].country).toBeNull();
    expect(c.dropped).toContainEqual({
      property: "ADR country",
      value: "United States",
    });
  });

  it("takes the country from Apple's grouped X-ABADR when ADR only names it", () => {
    // How Contacts exports every address: the name in `ADR`, the code beside it.
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.ADR;type=HOME;type=pref:;;723 Orchard Road;Avalon;PA;15202;United States",
        "item1.X-ABADR:us",
      ),
    );
    expect(c.postals[0].country).toBe("US");
    // The name told us nothing the code didn't, so it is not reported as lost —
    // and the code itself is metadata about the address, not a field of its own.
    expect(c.dropped).toEqual([]);
  });

  it("pairs each address with the code from its own group", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.ADR:;;1 Main St;Town;;;United States",
        "item1.X-ABADR:us",
        "item2.ADR:;;2 High St;Ville;;;France",
        "item2.X-ABADR:fr",
      ),
    );
    expect(c.postals.map((postal) => postal.country)).toEqual(["US", "FR"]);
  });

  it("keeps an ADR's own code over a grouped one, and still drops neither", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.ADR:;;1 Main St;Town;;;GB",
        "item1.X-ABADR:us",
      ),
    );
    expect(c.postals[0].country).toBe("GB");
  });

  it("reports the name when neither spelling yields a code", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.ADR:;;1 Main St;Town;;;United States",
        "item1.X-ABADR:usa",
      ),
    );
    expect(c.postals[0].country).toBeNull();
    expect(c.dropped).toContainEqual({
      property: "ADR country",
      value: "United States",
    });
  });
});

describe("parseVCards — birthday", () => {
  it("parses a full ISO BDAY", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "BDAY:1992-03-09"));
    expect(c.birthday).toEqual({ year: 1992, month: 3, day: 9 });
  });

  it("parses a v4 basic (no dashes) BDAY", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "BDAY:19920309"));
    expect(c.birthday).toEqual({ year: 1992, month: 3, day: 9 });
  });

  it("parses a year-less --MM-DD partial", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "BDAY:--0309"));
    expect(c.birthday).toEqual({ year: null, month: 3, day: 9 });
  });

  it("strips a time component", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "BDAY:1992-03-09T00:00:00Z"));
    expect(c.birthday).toEqual({ year: 1992, month: 3, day: 9 });
  });

  it("reads Apple's placeholder year as no year at all", () => {
    // What Contacts writes for a birthday saved without one: the year is 1604 in
    // the value, and the parameter says so. Believing it would file the person as
    // born in 1604.
    const [c] = parseVCards(
      card("FN:Jane Doe", "BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-09"),
    );
    expect(c.birthday).toEqual({ year: null, month: 3, day: 9 });
  });

  it("keeps a year the omit parameter does not name", () => {
    // Not Apple's convention, so the value is a year somebody meant.
    const [c] = parseVCards(
      card("FN:Jane Doe", "BDAY;X-APPLE-OMIT-YEAR=1604:1992-03-09"),
    );
    expect(c.birthday).toEqual({ year: 1992, month: 3, day: 9 });
  });
});

describe("parseVCards — anniversary", () => {
  it("parses an ANNIVERSARY onto the anniversary kind", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "ANNIVERSARY:2015-06-20"));
    expect(c.dates).toEqual([
      {
        kind: "anniversary",
        label: "Anniversary",
        date: { year: 2015, month: 6, day: 20 },
        note: null,
        id: null,
        relationshipId: null,
      },
    ]);
    // Not a wedding: the property names the occasion, not the couple.
    expect(c.birthday).toBeNull();
  });

  it("accepts a year-less ANNIVERSARY", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "ANNIVERSARY:--0620"));
    expect(c.dates[0].date).toEqual({ year: null, month: 6, day: 20 });
  });

  it("surfaces an unparseable ANNIVERSARY as dropped", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "ANNIVERSARY:sometime"));
    expect(c.dates).toEqual([]);
    expect(c.dropped).toContainEqual({
      property: "ANNIVERSARY",
      value: "sometime",
    });
  });
});

describe("parseVCards — Apple's custom labels", () => {
  /**
   * A card straight out of an iPhone puts a standard label in `TYPE` and the
   * user's own words in a grouped `X-ABLABEL` — and only there. Until the group
   * label reached `labelFrom`, every custom label on a real Apple export arrived
   * as "Other", which is the label the user is *least* likely to have meant.
   */
  it("reads a custom contact-method label out of the grouped X-ABLABEL", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.TEL:+1 555 100",
        "item1.X-ABLABEL:Mum's place",
        "item2.ADR:;;1 Beach Rd;Springfield;IL;62704;",
        "item2.X-ABLABEL:Beach house",
        "item3.EMAIL:jane@school.example",
        "item3.X-ABLABEL:School",
      ),
    );
    expect(c.phones[0].label).toBe("Mum's place");
    expect(c.postals[0].label).toBe("Beach house");
    expect(c.emails[0].label).toBe("School");
  });

  it("unwraps an Apple label constant rather than showing the sentinel", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.TEL:+1 555 100",
        "item1.X-ABLABEL:_$!<Home>!$_",
      ),
    );
    expect(c.phones[0].label).toBe("Home");
  });

  it("lets the grouped label win over a TYPE, as Contacts itself does", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.TEL;TYPE=HOME:+1 555 100",
        "item1.X-ABLABEL:Mum's place",
      ),
    );
    expect(c.phones[0].label).toBe("Mum's place");
  });
});

describe("parseVCards — Apple's labelled dates", () => {
  it("reads an anniversary written as a grouped X-ABDATE", () => {
    // Exactly how the Contacts app exports one, year and all.
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item2.X-ABDATE;type=pref:2015-06-20",
        "item2.X-ABLabel:_$!<Anniversary>!$_",
      ),
    );
    expect(c.dates).toEqual([
      {
        kind: "anniversary",
        label: "Anniversary",
        date: { year: 2015, month: 6, day: 20 },
        note: null,
        id: null,
        relationshipId: null,
      },
    ]);
    // The label is metadata about the date, not a field of its own.
    expect(c.dropped).toEqual([]);
  });

  it("reads a year-less X-ABDATE, the shape iOS actually exports", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item2.X-ABDATE;X-APPLE-OMIT-YEAR=1604;type=pref:1604-07-17",
        "item2.X-ABLabel:_$!<Anniversary>!$_",
      ),
    );
    expect(c.dates[0].date).toEqual({ year: null, month: 7, day: 17 });
  });

  it("pairs a date with its label whichever order the two arrive in", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.X-ABLabel:_$!<Anniversary>!$_",
        "item1.X-ABDATE:2015-06-20",
      ),
    );
    expect(c.dates).toHaveLength(1);
  });

  it("names a labelled date it has no kind for in dropped", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "item3.X-ABDATE:2019-05-30",
        "item3.X-ABLabel:Graduation",
      ),
    );
    expect(c.dates).toEqual([]);
    expect(c.dropped).toContainEqual({
      property: "Date (Graduation)",
      value: "2019-05-30",
    });
  });

  it("drops an X-ABDATE that no label says anything about", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "X-ABDATE:2019-05-30"));
    expect(c.dates).toEqual([]);
    expect(c.dropped).toContainEqual({
      property: "X-ABDATE",
      value: "2019-05-30",
    });
  });

  it("lets a birthday-labelled date fill the birthday, but never beat BDAY", () => {
    const onlyLabelled = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.X-ABDATE:1992-03-09",
        "item1.X-ABLabel:Birthday",
      ),
    )[0];
    expect(onlyLabelled.birthday).toEqual({ year: 1992, month: 3, day: 9 });
    // It fills the birthday rather than becoming a second dated milestone.
    expect(onlyLabelled.dates).toEqual([]);

    // The dedicated property wins even when it comes second in the card.
    const both = parseVCards(
      card(
        "FN:Jane Doe",
        "item1.X-ABDATE:1970-01-01",
        "item1.X-ABLabel:Birthday",
        "BDAY:1992-03-09",
      ),
    )[0];
    expect(both.birthday).toEqual({ year: 1992, month: 3, day: 9 });
  });
});

describe("parseVCards — social profiles", () => {
  it("reads an X-SOCIALPROFILE's service and handle", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "X-SOCIALPROFILE;TYPE=instagram:https://www.instagram.com/janedoe",
      ),
    );
    expect(c.socials).toEqual([
      {
        label: "Instagram",
        platform: "instagram",
        handle: "janedoe",
        url: "https://www.instagram.com/janedoe",
        platformUserId: null,
      },
    ]);
  });

  it("resolves the service from X-SERVICE-TYPE, as Apple exports it", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "X-SOCIALPROFILE;X-SERVICE-TYPE=Twitter:https://twitter.com/janedoe",
      ),
    );
    // Twitter is an alias, so the row lands on the platform that still exists.
    expect(c.socials[0].platform).toBe("x");
    expect(c.socials[0].handle).toBe("janedoe");
  });

  it("falls back to the host when nothing names the service", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "X-SOCIALPROFILE:https://bsky.app/profile/jane.example",
      ),
    );
    expect(c.socials[0].platform).toBe("bluesky");
    expect(c.socials[0].handle).toBe("jane.example");
  });

  it("takes an IMPP's service from its URI scheme", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "IMPP:telegram:janedoe"));
    expect(c.socials[0]).toMatchObject({
      platform: "telegram",
      handle: "janedoe",
      url: null,
    });
  });

  it("keeps a platform it has never heard of rather than dropping it", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "IMPP;X-SERVICE-TYPE=Matrix:matrix:@jane:example.org",
      ),
    );
    // An account on an unknown network is still a real way to reach somebody.
    expect(c.socials[0].platform).toBe("matrix");
    expect(c.dropped).not.toContainEqual(
      expect.objectContaining({ property: "IMPP" }),
    );
  });

  it("imports a URL only when its host names a platform", () => {
    const [social] = parseVCards(
      card("FN:Jane Doe", "URL:https://www.linkedin.com/in/janedoe"),
    );
    expect(social.socials[0]).toMatchObject({
      platform: "linkedin",
      handle: "janedoe",
    });

    // A personal homepage is not a social profile, and guessing would turn
    // every card's website into a fake row.
    const [homepage] = parseVCards(
      card("FN:Jane Doe", "URL:https://janedoe.example/blog"),
    );
    expect(homepage.socials).toEqual([]);
    expect(homepage.dropped).toContainEqual({
      property: "URL",
      value: "https://janedoe.example/blog",
    });
  });

  it("surfaces a value naming no service at all as dropped", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "IMPP:janedoe"));
    expect(c.socials).toEqual([]);
    expect(c.dropped).toContainEqual({ property: "IMPP", value: "janedoe" });
  });
});

describe("parseVCards — gender & dropped", () => {
  it("maps GENDER letters to the enum", () => {
    expect(parseVCards(card("FN:A B", "GENDER:F"))[0].gender).toBe("female");
    expect(parseVCards(card("FN:A B", "GENDER:M"))[0].gender).toBe("male");
    expect(parseVCards(card("FN:A B", "GENDER:O"))[0].gender).toBe("nonbinary");
    expect(parseVCards(card("FN:A B", "GENDER:U"))[0].gender).toBeNull();
  });

  it("surfaces NOTE and ORG as dropped fields", () => {
    const [c] = parseVCards(
      card("FN:Jane Doe", "ORG:Acme, Inc.", "NOTE:met at a wedding"),
    );
    expect(c.dropped).toContainEqual({ property: "ORG", value: "Acme, Inc." });
    expect(c.dropped).toContainEqual({
      property: "NOTE",
      value: "met at a wedding",
    });
  });

  it("records a PHOTO's presence without its payload", () => {
    const [c] = parseVCards(
      card("FN:Jane Doe", "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABA"),
    );
    expect(c.dropped).toContainEqual({
      property: "PHOTO",
      value: "(embedded image)",
    });
  });
});

/**
 * The card's own identity, read from a *foreign* card rather than through the
 * round trip. `write.test.ts` proves our own file survives the journey; these
 * prove the reader is tolerant of what anybody else writes, which is the half a
 * round-trip test can never reach.
 */
describe("parseVCards — card identity", () => {
  it("strips the urn:uuid: prefix from a UID", () => {
    const id = "9f1c4b3e-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
    expect(parseVCards(card("FN:Jane Doe", `UID:urn:uuid:${id}`))[0].uid).toBe(
      id,
    );
  });

  it("keeps a UID that is not a urn, rather than refusing it", () => {
    // Google and Outlook both write a bare opaque string. It is still the id
    // that card's author gave it, and dropping it would lose the only handle we
    // have on "this is the same person as last time".
    const [c] = parseVCards(card("FN:Jane Doe", "UID:abc123-not-a-urn"));
    expect(c.uid).toBe("abc123-not-a-urn");
  });

  it("reads KIND:x-pet whatever its casing, and anything else as a person", () => {
    expect(parseVCards(card("FN:Rex", "KIND:X-Pet"))[0].kind).toBe("pet");
    expect(parseVCards(card("FN:A B", "KIND:individual"))[0].kind).toBe(
      "individual",
    );
    // `group` and `org` are cards we have no shape for; both are far closer to
    // a person than to a pet, so neither becomes one.
    expect(parseVCards(card("FN:Acme", "KIND:org"))[0].kind).toBe("individual");
  });

  it("reads CATEGORIES as tags, keeping an escaped comma inside one", () => {
    const [c] = parseVCards(
      card("FN:Jane Doe", "CATEGORIES:Family,Smith\\, family,  Work  "),
    );
    expect(c.tags).toEqual(["Family", "Smith, family", "Work"]);
  });

  it("drops an empty entry in a CATEGORIES list rather than minting a blank tag", () => {
    expect(
      parseVCards(card("FN:Jane Doe", "CATEGORIES:Family,,Work"))[0].tags,
    ).toEqual(["Family", "Work"]);
  });

  it("reads REV and X-LEAPSAKE-CREATED as instants", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "REV:2026-09-07T12:00:00Z",
        "X-LEAPSAKE-CREATED:2024-03-09T01:35:00Z",
      ),
    );
    expect(c.updatedAt).toBe(Date.UTC(2026, 8, 7, 12, 0, 0));
    expect(c.createdAt).toBe(Date.UTC(2024, 2, 9, 1, 35, 0));
  });

  it("leaves an unparseable timestamp null instead of throwing", () => {
    // vCard 2.1 wrote `REV` in dialects `Date.parse` cannot read. One bad line
    // must never cost the whole card.
    const [c] = parseVCards(card("FN:Jane Doe", "REV:not-a-date"));
    expect(c.updatedAt).toBeNull();
    expect(c.displayName).toBe("Jane Doe");
  });

  it("reads X-LEAPSAKE-SELF only when it says TRUE", () => {
    expect(
      parseVCards(card("FN:Jane Doe", "X-LEAPSAKE-SELF:true"))[0].isSelf,
    ).toBe(true);
    expect(
      parseVCards(card("FN:Jane Doe", "X-LEAPSAKE-SELF:FALSE"))[0].isSelf,
    ).toBe(false);
    expect(parseVCards(card("FN:Jane Doe"))[0].isSelf).toBe(false);
  });

  /**
   * `UID`, `KIND` and `REV` used to sit in the parser's `STRUCTURAL` set, which
   * is what kept them out of `dropped` while they were unread. Now that they are
   * read they need a `case` of their own, and forgetting one would not lose the
   * value quietly — it would show a user their own `KIND` in the review's "not
   * imported" list. That is the regression this pins.
   */
  it("surfaces none of the identity properties as dropped", () => {
    const [c] = parseVCards(
      card(
        "FN:Rex",
        "UID:urn:uuid:9f1c4b3e-1c4b-4f2a-9d3e-6a7b8c9d0e1f",
        "KIND:x-pet",
        "REV:2026-09-07T12:00:00Z",
        "CATEGORIES:Family",
        "X-LEAPSAKE-SELF:TRUE",
        "X-LEAPSAKE-CREATED:2024-03-09T01:35:00Z",
      ),
    );
    expect(c.dropped).toEqual([]);
  });
});

describe("parseVCards — the X-LEAPSAKE parameters", () => {
  it("reads a phone's extension and ISO country", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "TEL;TYPE=WORK;X-LEAPSAKE-EXT=4021;X-LEAPSAKE-COUNTRY=GB:+44 20 7946 0018",
      ),
    );
    expect(c.phones[0].extension).toBe("4021");
    expect(c.phones[0].country).toBe("GB");
  });

  it("leaves a foreign card's phone without either", () => {
    // A standard `TEL` has nowhere to put an extension or a country, so absent
    // is the honest answer rather than a guess parsed out of the number.
    const [c] = parseVCards(
      card("FN:Jane Doe", "TEL;TYPE=WORK:+44 20 7946 0018"),
    );
    expect(c.phones[0].extension).toBeNull();
    expect(c.phones[0].country).toBeNull();
  });

  it("reads a social profile's opaque platform user id", () => {
    const [c] = parseVCards(
      card(
        "FN:Jane Doe",
        "X-SOCIALPROFILE;X-SERVICE-TYPE=x;X-LEAPSAKE-USERID=1442901:https://x.com/janedoe",
      ),
    );
    expect(c.socials[0].platformUserId).toBe("1442901");
  });
});

describe("parseVCards — format handling", () => {
  it("parses multiple cards in one file", () => {
    const text = `${card("FN:Jane Doe")}\r\n${card("FN:John Roe")}`;
    const contacts = parseVCards(text);
    expect(contacts.map((c) => c.displayName)).toEqual([
      "Jane Doe",
      "John Roe",
    ]);
  });

  it("un-folds continuation lines", () => {
    const [c] = parseVCards(
      card("FN:Jane Doe", "NOTE:this note is very\r\n  long and folded"),
    );
    expect(c.dropped).toContainEqual({
      property: "NOTE",
      value: "this note is very long and folded",
    });
  });

  it("un-escapes escaped commas, semicolons and newlines in values", () => {
    const [c] = parseVCards(card("FN:Jane Doe", "NOTE:a\\, b\\; c\\nd"));
    expect(c.dropped).toContainEqual({
      property: "NOTE",
      value: "a, b; c\nd",
    });
  });

  it("strips a group prefix from a property name", () => {
    const [c] = parseVCards(
      card("FN:Jane Doe", "item1.EMAIL;TYPE=WORK:j@x.com"),
    );
    expect(c.emails).toEqual([{ label: "Work", address: "j@x.com" }]);
  });

  it("handles a quoted parameter value containing a colon", () => {
    const [c] = parseVCards(
      card("FN:Jane Doe", 'EMAIL;LABEL="a:b";TYPE=HOME:jane@home.example'),
    );
    expect(c.emails).toEqual([{ label: "Home", address: "jane@home.example" }]);
  });
});

// `RELATED` names somebody the contact is connected to. When it gives a plain
// name, that becomes an unpublished person attached to the contact — which is
// exactly what the card is claiming: a spouse's *name*, not a spouse's record.
describe("parseVCards — RELATED", () => {
  it("maps a kinship TYPE to its role", () => {
    const [c] = parseVCards(
      card(
        "FN:Sam Carter",
        "RELATED;TYPE=spouse;VALUE=text:Jen Davis",
        "RELATED;TYPE=child;VALUE=text:Ben",
      ),
    );
    expect(c.related).toEqual([
      {
        name: "Jen Davis",
        role: "spouse",
        roleNote: null,
        otherUid: null,
        relationshipId: null,
      },
      {
        name: "Ben",
        role: "child",
        roleNote: null,
        otherUid: null,
        relationshipId: null,
      },
    ]);
  });

  it("maps both spellings of a colleague", () => {
    const [c] = parseVCards(
      card(
        "FN:Sam Carter",
        "RELATED;TYPE=co-worker;VALUE=text:Ada",
        "RELATED;TYPE=colleague;VALUE=text:Grace",
      ),
    );
    expect(c.related.map((r) => r.role)).toEqual(["coworker", "coworker"]);
  });

  // The half of RFC 6350's vocabulary that describes a kind of acquaintance
  // rather than a kinship has no role here, and the word is worth more on the
  // row than in the bin.
  it("keeps an unmapped TYPE as the note on an `other` role", () => {
    const [c] = parseVCards(
      card("FN:Sam Carter", "RELATED;TYPE=muse;VALUE=text:Ada"),
    );
    expect(c.related).toEqual([
      {
        name: "Ada",
        role: "other",
        roleNote: "muse",
        otherUid: null,
        relationshipId: null,
      },
    ]);
  });

  it("falls back to a bare `related` note when the card gives no TYPE", () => {
    const [c] = parseVCards(card("FN:Sam Carter", "RELATED;VALUE=text:Ada"));
    expect(c.related).toEqual([
      {
        name: "Ada",
        role: "other",
        roleNote: "related",
        otherUid: null,
        relationshipId: null,
      },
    ]);
  });

  // A URI points at another card, so it can only be read when that card is in
  // the same file. This one is not, so the edge names nobody reachable and stays
  // visible as something that was not imported.
  it("drops a reference to a card the file does not contain", () => {
    const [c] = parseVCards(
      card(
        "FN:Sam Carter",
        "RELATED;TYPE=friend:urn:uuid:03a0e51f-d1aa-4385-8a53-e29025acd8af",
      ),
    );
    expect(c.related).toEqual([]);
    expect(c.dropped).toContainEqual({
      property: "RELATED",
      value: "urn:uuid:03a0e51f-d1aa-4385-8a53-e29025acd8af",
    });
  });

  it("resolves a reference to a card that is here, taking its name", () => {
    const uid = "03a0e51f-d1aa-4385-8a53-e29025acd8af";
    const [sam, ada] = parseVCards(
      [
        card("FN:Sam Carter", `RELATED;TYPE=friend:urn:uuid:${uid}`),
        card(`UID:urn:uuid:${uid}`, "FN:Ada Lovelace"),
      ].join("\r\n"),
    );
    // The name is not on the `RELATED` line at all — it comes from Ada's card.
    expect(sam.related).toEqual([
      {
        name: "Ada Lovelace",
        role: "friend",
        roleNote: null,
        otherUid: uid,
        relationshipId: null,
      },
    ]);
    expect(sam.dropped).toEqual([]);
    expect(ada.uid).toBe(uid);
  });

  it("reads the exact role from X-LEAPSAKE-ROLE over the standard TYPE", () => {
    const [c] = parseVCards(
      card(
        "FN:Sam Carter",
        "RELATED;TYPE=parent;X-LEAPSAKE-ROLE=mother;VALUE=text:Ada",
      ),
    );
    expect(c.related[0]).toMatchObject({ role: "mother", roleNote: null });
  });

  it("ignores an X-LEAPSAKE-ROLE naming a role Leapsake does not have", () => {
    // A newer build's vocabulary, or a hand-edited card. Falling back to `TYPE`
    // is better than refusing the row or coercing it to something invalid.
    const [c] = parseVCards(
      card(
        "FN:Sam Carter",
        "RELATED;TYPE=parent;X-LEAPSAKE-ROLE=grand-vizier;VALUE=text:Ada",
      ),
    );
    expect(c.related[0]).toMatchObject({ role: "parent" });
  });

  it("reads the edge id so an importer can pair the two halves", () => {
    const [c] = parseVCards(
      card(
        "FN:Sam Carter",
        "RELATED;X-LEAPSAKE-ROLE=spouse;X-LEAPSAKE-REL-ID=edge-1;VALUE=text:Ada",
      ),
    );
    expect(c.related[0].relationshipId).toBe("edge-1");
  });

  it("drops a mailto: reference too", () => {
    const [c] = parseVCards(
      card("FN:Sam Carter", "RELATED;TYPE=friend:mailto:ada@example.com"),
    );
    expect(c.related).toEqual([]);
    expect(c.dropped.map((d) => d.property)).toContain("RELATED");
  });

  it("no longer lists a handled RELATED as dropped", () => {
    const [c] = parseVCards(
      card("FN:Sam Carter", "RELATED;TYPE=spouse;VALUE=text:Jen"),
    );
    expect(c.dropped).toEqual([]);
  });
});
