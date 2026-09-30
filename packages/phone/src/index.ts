import {
  type CountryCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from "libphonenumber-js";

/** A number in E.164, reading one without its country code as `region`'s;
 *  `""` for a number not valid there, rather than a wrong code. */
export function phoneE164(raw: string, region?: string | null): string {
  const country =
    region != null && isSupportedCountry(region) ? region : undefined;
  const parsed = parsePhoneNumberFromString(raw, country as CountryCode);
  return parsed?.isValid() ? parsed.number : "";
}
