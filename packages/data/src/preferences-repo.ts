import { deterministicUuid } from "@leapsake/bytes";
import {
  type DateFormat,
  PREFERENCES_ID_NAME,
  PREFERENCES_NAMESPACE,
  type Preferences,
  dateFormatSchema,
  preferencesSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type EntityRepo, createEntityRepo } from "./entity-repo.js";

/** The preferences row's fixed id, the same on every device. Never change it:
 *  that would mint a second row on sync. */
export const PREFERENCES_ID = deterministicUuid(
  PREFERENCES_NAMESPACE,
  PREFERENCES_ID_NAME,
);

export interface PreferencesRepo extends EntityRepo<Preferences> {
  /** The chosen date format, or `null` for the region's default. */
  getDateFormat(): Promise<DateFormat | null>;
  /** Choose a date format, or `null` to go back to the region's default. */
  setDateFormat(format: DateFormat | null): Promise<void>;
}

/** The preferences singleton; every write targets {@link PREFERENCES_ID}. */
export function createPreferencesRepo(driver: SqliteDriver): PreferencesRepo {
  const base = createEntityRepo<Preferences>({
    driver,
    table: "preferences",
    schema: preferencesSchema,
  });

  return {
    ...base,

    getDateFormat: async () =>
      (await base.get(PREFERENCES_ID))?.dateFormat ?? null,

    async setDateFormat(format) {
      const parsed = format === null ? null : dateFormatSchema.parse(format);
      const now = Date.now();
      if ((await base.getIncludingDeleted(PREFERENCES_ID)) === undefined) {
        await base.insert({
          id: PREFERENCES_ID,
          dateFormat: parsed,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        return;
      }
      // The monotonic `MAX(now, updated_at + 1)` clock, so the choice wins LWW.
      await driver.run(
        `UPDATE preferences
            SET date_format = ?, deleted_at = NULL,
                updated_at = MAX(?, updated_at + 1)
          WHERE id = ?`,
        [parsed, now, PREFERENCES_ID],
      );
    },
  };
}
