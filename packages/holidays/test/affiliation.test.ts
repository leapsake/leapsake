import {
  RELIGIONS,
  type Religion,
  contactCountryOptions,
} from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  affiliationsFor,
  isAffiliated,
  personAffiliations,
  residenceOf,
} from "../src/index.js";

/** Whether someone with these facts keeps a catalog holiday implicitly. */
function keeps(
  slug: string,
  person: {
    nationalities?: string[];
    religions?: Religion[];
    addressCountries?: (string | null)[];
    yourCountry?: string | null;
  },
): boolean {
  const holiday = affiliationsFor(slug);
  if (holiday === null) throw new Error(`no catalog entry ${slug}`);
  const residence = residenceOf(
    person.addressCountries ?? [],
    person.yourCountry ?? null,
  );
  return isAffiliated(
    holiday,
    personAffiliations(
      {
        nationalities: person.nationalities ?? [],
        religions: person.religions ?? [],
      },
      residence,
    ),
  );
}

describe("catalog affiliations", () => {
  const codes = new Set(contactCountryOptions.map((c) => c.code));

  it.each(CATALOG.map((e) => [e.slug, e.affiliations] as const))(
    "%s names real religions and country codes",
    (_slug, affiliations) => {
      for (const r of affiliations.religions) expect(RELIGIONS).toContain(r);
      for (const c of affiliations.countries) expect(codes).toContain(c);
    },
  );

  it("leaves the days that celebrate someone, and Columbus Day, to explicit observers", () => {
    const explicitOnly = CATALOG.filter(
      (e) =>
        e.affiliations.religions.length + e.affiliations.countries.length === 0,
    ).map((e) => e.slug);
    expect(explicitOnly.sort()).toEqual([
      "uk-mothering-sunday",
      "us-columbus-day",
      "us-fathers-day",
      "us-mothers-day",
    ]);
  });

  it("knows nothing of a holiday outside the catalog", () => {
    expect(affiliationsFor("bailey-building-and-loan-day")).toBeNull();
  });
});

describe("who keeps a holiday implicitly", () => {
  it("is anyone holding its religion, wherever they live", () => {
    expect(
      keeps("christmas", { religions: ["christian"], yourCountry: "IN" }),
    ).toBe(true);
    expect(
      keeps("hanukkah", { religions: ["jewish"], yourCountry: "US" }),
    ).toBe(true);
  });

  it("is anyone in a country that keeps it, whatever their religion", () => {
    expect(keeps("christmas", { yourCountry: "US" })).toBe(true);
    expect(
      keeps("christmas", { religions: ["hindu"], yourCountry: "IN" }),
    ).toBe(false);
  });

  it("never reads a religion into a country", () => {
    expect(
      keeps("hanukkah", { nationalities: ["IL"], yourCountry: "IL" }),
    ).toBe(false);
  });

  it("keeps Orthodox holidays to the countries that keep them", () => {
    expect(keeps("orthodox-christmas", { religions: ["christian"] })).toBe(
      false,
    );
    expect(keeps("orthodox-christmas", { nationalities: ["RS"] })).toBe(true);
    expect(keeps("orthodox-easter", { addressCountries: ["GR"] })).toBe(true);
  });

  it("counts a nationality alongside where someone lives", () => {
    const americanInCanada = {
      nationalities: ["US"],
      addressCountries: ["CA"],
      yourCountry: "US",
    };
    expect(keeps("us-independence-day", americanInCanada)).toBe(true);
    expect(keeps("ca-canada-day", americanInCanada)).toBe(true);
  });

  it("takes your country for someone whose addresses don't say", () => {
    expect(keeps("us-thanksgiving", { addressCountries: [null] })).toBe(false);
    expect(
      keeps("us-thanksgiving", { addressCountries: [null], yourCountry: "US" }),
    ).toBe(true);
  });

  it("takes your country even alongside a stated nationality", () => {
    expect(
      keeps("us-thanksgiving", { nationalities: ["IE"], yourCountry: "US" }),
    ).toBe(true);
  });

  it("lets an address outrank your country", () => {
    expect(
      keeps("us-thanksgiving", { addressCountries: ["FR"], yourCountry: "US" }),
    ).toBe(false);
  });

  it("is nearly everyone for New Year's Day", () => {
    expect(keeps("new-years-day", { yourCountry: "JP" })).toBe(true);
    expect(keeps("new-years-day", { yourCountry: "SA" })).toBe(false);
  });
});
