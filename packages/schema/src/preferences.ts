import { z } from "zod";
import { countryCodeSchema } from "./contact-method.js";
import { dateFormatSchema } from "./date-format.js";

/**
 * The namespace the preferences row's id is derived under, so every device
 * mints the same row. Never change it.
 */
export const PREFERENCES_NAMESPACE = "leapsake:preferences";

/** The name the one preferences row's id is derived from. */
export const PREFERENCES_ID_NAME = "singleton";

/** The user's synced preferences, one row; a `null` setting is the default. */
export const preferencesSchema = z.object({
  id: z.uuid(), // always the constant PREFERENCES_ID, minted by the repo
  dateFormat: dateFormatSchema.nullable(),
  country: countryCodeSchema.nullable(),
  // The country is a device region's guess, not anyone's choice.
  countrySeeded: z.boolean(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Preferences = z.infer<typeof preferencesSchema>;

/** A row holding a choice beats one that holds only defaults and guesses. */
export function preferencesHaveHistory(row: Preferences): boolean {
  return (
    row.dateFormat !== null || (row.country !== null && !row.countrySeeded)
  );
}

/** Where your country came from: picked, your own address, or a region. */
export type YourCountrySource = "chosen" | "address" | "device";

/** Where Leapsake takes you to live, and why. */
export interface YourCountry {
  country: string | null;
  source: YourCountrySource | null;
}

/** A choice, else your first address with a country, else the seed. */
export function yourCountry(
  stored: { country: string | null; seeded: boolean },
  ownAddresses: readonly { country: string | null }[],
): YourCountry {
  if (stored.country !== null && !stored.seeded) {
    return { country: stored.country, source: "chosen" };
  }
  const addressed = ownAddresses.find((a) => a.country !== null)?.country;
  if (addressed !== undefined && addressed !== null) {
    return { country: addressed, source: "address" };
  }
  return stored.country === null
    ? { country: null, source: null }
    : { country: stored.country, source: "device" };
}
