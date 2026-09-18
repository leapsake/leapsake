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
 * Seed the bundled holiday catalog into the synced `holidays` table.
 *
 * Runs at store open, gated on {@link CATALOG_VERSION} against a **device-local**
 * mark. It is deliberately not a migration: a migration runs once at schema
 * version N, but the catalog updates independently of the schema and must
 * re-apply on every bundle bump. Nor is it in `@leapsake/data`, since it is
 * composition — the catalog package meeting the holidays repo — which is core's
 * job.
 *
 * ## Why the write is `upsertFromRemote`
 *
 * The bundled catalog is treated as **just another peer**. Going through the
 * sync merge path rather than a bespoke insert gets research §2.5's semantics
 * with no merge code of its own, because each row carries the catalog entry's
 * *authored* time rather than local write time:
 *
 * - every device seeding the same bundle writes byte-identical rows with
 *   identical timestamps, so merges are no-ops
 * - a device that receives a newer catalog over sync has strictly later
 *   timestamps, and a later re-seed from an older bundle simply loses
 * - so an old device can never silently revert a newer catalog — the failure
 *   mode that made "don't sync the catalog" look attractive in the first place
 *
 * ## Failure behaviour
 *
 * The version mark is written **after** every row lands, so a seed that throws
 * part-way leaves the mark unbumped and retries on next open. Re-applying rows
 * that already merged is a no-op, so the retry is safe — the same idempotence
 * the sync engine relies on when it applies records one at a time.
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

/**
 * The `holidays` row a catalog entry becomes. Pure and total, so two devices on
 * the same bundle produce byte-identical rows — the property whole-row LWW
 * needs to treat a re-seed as a no-op.
 *
 * A retired entry becomes a **tombstone** rather than being dropped from the
 * bundle, because absence cannot communicate removal: a device that already
 * seeded the row would keep it forever with nothing to tell it otherwise
 * (research §3).
 */
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
