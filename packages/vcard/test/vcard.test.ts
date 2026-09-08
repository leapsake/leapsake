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
      { name: "Jen Davis", role: "spouse", roleNote: null },
      { name: "Ben", role: "child", roleNote: null },
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
      { name: "Ada", role: "other", roleNote: "muse" },
    ]);
  });

  it("falls back to a bare `related` note when the card gives no TYPE", () => {
    const [c] = parseVCards(card("FN:Sam Carter", "RELATED;VALUE=text:Ada"));
    expect(c.related).toEqual([
      { name: "Ada", role: "other", roleNote: "related" },
    ]);
  });

  // A URI points at another card, which would have to be resolved against that
  // card's own import — see the TODO in the reader. Until then it stays visible
  // as something that was not imported, rather than silently going nowhere.
  it("drops a reference to another card rather than naming it", () => {
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
