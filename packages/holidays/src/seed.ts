import { CATALOG, CATALOG_VERSION, type HolidayEntry } from "./catalog.js";
import { canonicalRecurrenceJson } from "./recurrence.js";
import {
  type SqliteDriver,
  createHolidaysRepo,
  createSyncStateRepo,
  holidayIdFor,
} from "@leapsake/data";
import type { Holiday } from "@leapsake/schema";

/**
 * Seeds the bundled catalog as a sync peer, at store open, once per
 * {@link CATALOG_VERSION}; see the README's _Seeding_.
 */
export async function seedHolidayCatalog(opts: {
  driver: SqliteDriver;
  /** Override the bundled catalog (tests). */
  catalog?: readonly HolidayEntry[];
  /** Override the bundled version (tests). */
  version?: number;
}): Promise<{ seeded: boolean }> {
  const { driver } = opts;
  const catalog = opts.catalog ?? CATALOG;
  const version = opts.version ?? CATALOG_VERSION;

  const syncState = createSyncStateRepo(driver);
  if ((await syncState.getHolidayCatalogVersion()) >= version) {
    return { seeded: false };
  }

  const holidays = createHolidaysRepo(driver);
  for (const entry of catalog) {
    await holidays.upsertFromRemote(rowFor(entry));
  }
  await syncState.setHolidayCatalogVersion(version);
  return { seeded: true };
}

/** The byte-identical row a catalog entry becomes; a retired entry becomes a
 *  tombstone, since absence can't say “removed”. */
function rowFor(entry: HolidayEntry): Holiday {
  return {
    id: holidayIdFor(entry.slug),
    slug: entry.slug,
    name: entry.name,
    greeting: entry.greeting,
    recurrence: canonicalRecurrenceJson(entry.recurrence),
    durationDays: entry.durationDays ?? null,
    familyId: entry.familyId ?? null,
    impliedByLocale: entry.impliedByLocale ?? false,
    origin: "catalog",
    createdAt: entry.authoredAt,
    // A retirement is an edit, so it must out-rank the row it retires.
    updatedAt: entry.retiredAt ?? entry.authoredAt,
    deletedAt: entry.retiredAt ?? null,
  };
}
