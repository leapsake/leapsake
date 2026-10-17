import { type Religion, contactCountryOptions } from "@leapsake/schema";

/** Who keeps a holiday: anyone holding one of these religions, or tied to one
 *  of these countries by nationality or residence. */
export interface HolidayAffiliations {
  religions: readonly Religion[];
  countries: readonly string[];
}

/** What ties a person to holidays: their stated religions, and every country
 *  they're a national of or live in. */
export interface PersonAffiliations {
  religions: readonly Religion[];
  countries: readonly string[];
}

/** Kept by those of a religion, wherever they are. */
export function religion(...religions: Religion[]): HolidayAffiliations {
  return { religions, countries: [] };
}

/** Kept by those tied to a country. */
export function countries(...codes: string[]): HolidayAffiliations {
  return { religions: [], countries: codes };
}

/** Kept in every country but these. */
export function everywhereBut(...codes: string[]): HolidayAffiliations {
  const left = new Set(codes);
  return countries(
    ...contactCountryOptions.map((c) => c.code).filter((c) => !left.has(c)),
  );
}

/** Where a person lives: their addresses' countries, else your country. */
export function residenceOf(
  addressCountries: readonly (string | null)[],
  yourCountry: string | null,
): string[] {
  const stated = addressCountries.filter((c): c is string => c !== null);
  if (stated.length > 0) return [...new Set(stated)];
  return yourCountry === null ? [] : [yourCountry];
}

/** A person's affiliations: religions as stated, nationalities and residence
 *  as one set of countries. */
export function personAffiliations(
  person: { nationalities: readonly string[]; religions: readonly Religion[] },
  residence: readonly string[],
): PersonAffiliations {
  return {
    religions: person.religions,
    countries: [...new Set([...person.nationalities, ...residence])],
  };
}

/** Whether any of a person's affiliations is one the holiday is kept by. */
export function isAffiliated(
  holiday: HolidayAffiliations,
  person: PersonAffiliations,
): boolean {
  return (
    holiday.religions.some((r) => person.religions.includes(r)) ||
    holiday.countries.some((c) => person.countries.includes(c))
  );
}
