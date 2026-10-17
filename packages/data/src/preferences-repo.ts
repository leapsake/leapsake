import { deterministicUuid } from "@leapsake/bytes";
import {
  type DateFormat,
  PREFERENCES_ID_NAME,
  PREFERENCES_NAMESPACE,
  type Preferences,
  countryCodeSchema,
  dateFormatSchema,
  preferencesHaveHistory,
  preferencesSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type EntityRepo, createEntityRepo } from "./entity-repo.js";
import { assignmentClause, resolveCodec } from "./syncable.js";

/** The preferences row's fixed id, the same on every device. Never change it:
 *  that would mint a second row on sync. */
export const PREFERENCES_ID = deterministicUuid(
  PREFERENCES_NAMESPACE,
  PREFERENCES_ID_NAME,
);

type SettingsPatch = Partial<
  Pick<Preferences, "dateFormat" | "country" | "countrySeeded">
>;

const DEFAULTS = {
  dateFormat: null,
  country: null,
  countrySeeded: false,
} as const satisfies SettingsPatch;

const BOOLEAN_FIELDS = ["countrySeeded"] as const;

export interface PreferencesRepo extends EntityRepo<Preferences> {
  /** The chosen date format, or `null` for the region's default. */
  getDateFormat(): Promise<DateFormat | null>;
  /** Choose a date format, or `null` to go back to the region's default. */
  setDateFormat(format: DateFormat | null): Promise<void>;
  /** Your country as stored, and whether it is only a seed. */
  getCountry(): Promise<{ country: string | null; seeded: boolean }>;
  /** Choose your country, an ISO alpha-2 code, or `null` to drop the choice
   *  so the next {@link seedCountry} fills it again. */
  setCountry(code: string | null): Promise<void>;
  /** Store `region` as your country only while none is stored. A seed loses
   *  to any choice made on another device. Ignores a non-country region. */
  seedCountry(region: string | null): Promise<void>;
}

/** The preferences singleton; every write targets {@link PREFERENCES_ID}. */
export function createPreferencesRepo(driver: SqliteDriver): PreferencesRepo {
  const base = createEntityRepo<Preferences>({
    driver,
    table: "preferences",
    schema: preferencesSchema,
    booleans: BOOLEAN_FIELDS,
    hasHistory: preferencesHaveHistory,
  });
  const codec = resolveCodec<Preferences>({
    schema: preferencesSchema,
    booleans: BOOLEAN_FIELDS,
  });

  async function write(patch: SettingsPatch): Promise<void> {
    const existing = await base.getIncludingDeleted(PREFERENCES_ID);
    const now = Date.now();
    if (existing === undefined) {
      await base.insert({
        id: PREFERENCES_ID,
        ...DEFAULTS,
        ...patch,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      return;
    }
    const cols = await codec.toRow(
      preferencesSchema.parse({ ...existing, ...patch, deletedAt: null }),
    );
    const [setSql, params] = assignmentClause(cols, [
      "id",
      "created_at",
      "updated_at",
    ]);
    // The monotonic `MAX(now, updated_at + 1)` clock, so the write wins LWW.
    await driver.run(
      `UPDATE preferences
          SET ${setSql}, updated_at = MAX(?, updated_at + 1)
        WHERE id = ?`,
      [...params, now, PREFERENCES_ID],
    );
  }

  async function country() {
    const row = await base.get(PREFERENCES_ID);
    return {
      country: row?.country ?? null,
      seeded: row?.countrySeeded ?? false,
    };
  }

  return {
    ...base,

    getDateFormat: async () =>
      (await base.get(PREFERENCES_ID))?.dateFormat ?? null,

    setDateFormat: async (format) =>
      write({
        dateFormat: format === null ? null : dateFormatSchema.parse(format),
      }),

    getCountry: country,

    setCountry: async (code) =>
      write({
        country: code === null ? null : countryCodeSchema.parse(code),
        countrySeeded: false,
      }),

    async seedCountry(region) {
      const parsed = countryCodeSchema.safeParse(region);
      if (!parsed.success || (await country()).country !== null) return;
      await write({ country: parsed.data, countrySeeded: true });
    },
  };
}
