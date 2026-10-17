import { countryName, holidayNameIn } from "@leapsake/schema";
import type { HolidayOrigin } from "@leapsake/schema";
import { nameCountryFor } from "./catalog.js";

/** A holiday's name as shown: one another country shares names its country,
 *  unless it is yours. */
export function holidayDisplayName(
  holiday: { origin: HolidayOrigin; slug: string; name: string },
  yourCountry: string | null,
): string {
  const country =
    holiday.origin === "catalog" ? nameCountryFor(holiday.slug) : null;
  return country === null || country === yourCountry
    ? holiday.name
    : holidayNameIn(holiday.name, countryName(country));
}
