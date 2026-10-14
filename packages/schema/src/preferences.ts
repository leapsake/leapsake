import { z } from "zod";
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
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Preferences = z.infer<typeof preferencesSchema>;
