import { getLocales } from "expo-localization";

/** The device's region setting as an ISO country code, or `null`. */
export function deviceRegion(): string | null {
  return getLocales()[0]?.regionCode ?? null;
}
