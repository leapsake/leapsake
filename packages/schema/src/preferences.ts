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

/** Where Leapsake takes you to live, and whether your own address says so. */
export interface YourCountry {
  country: string | null;
  fromAddress: boolean;
}

/** Your first address with a country, else the setting. */
export function yourCountry(
  setting: string | null,
  ownAddresses: readonly { country: string | null }[],
): YourCountry {
  const addressed = ownAddresses.find((a) => a.country !== null)?.country;
  return addressed === undefined || addressed === null
    ? { country: setting, fromAddress: false }
    : { country: addressed, fromAddress: true };
}
