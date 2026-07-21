import { seedHolidayCatalog } from "@leapsake/core";
import {
  createHiddenHolidaysRepo,
  createHolidaysRepo,
  createObservancesRepo,
  createSyncStateRepo,
  holidayIdFor,
  observanceIdFor,
  runMigrations,
} from "@leapsake/data";
import type { SqliteDriver } from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The catalog seed and the three holiday repositories, against the real
 * production desktop engine. The seed's whole job is getting whole-row LWW to do
 * the right thing on its own, so most of these assert *merge* outcomes rather
 * than "did a row appear".
 */
describe("holiday catalog seed", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
  });

  afterEach(() => cleanup());

  /** A minimal stand-in catalog, so version behaviour is tested independently. */
  const entry = (over: Record<string, unknown> = {}) => ({
    slug: "test-holiday",
    name: "Test Holiday",
    greeting: "a Happy Test",
    recurrence: { type: "fixed" as const, month: 3, day: 1 },
    authoredAt: Date.UTC(2026, 0, 1),
    ...over,
  });

  it("seeds the bundled catalog on a fresh store", async () => {
    const result = await seedHolidayCatalog({ driver });
    expect(result.seeded).toBe(true);

    const holidays = createHolidaysRepo(driver);
    const christmas = await holidays.getBySlug("christmas");
    expect(christmas?.name).toBe("Christmas");
    expect(christmas?.origin).toBe("catalog");
    // The id is derived from the slug, so every device mints the same one.
    expect(christmas?.id).toBe(holidayIdFor("christmas"));
  });

  it("stamps rows with the catalog's authored time, not local write time", async () => {
    // This is what makes ordinary LWW correct across catalog releases: a device
    // seeding an older bundle writes older timestamps and therefore loses.
    const authoredAt = Date.UTC(2026, 0, 1);
    await seedHolidayCatalog({
      driver,
      version: 1,
      catalog: [entry({ authoredAt })],
    });
    const row = await createHolidaysRepo(driver).getBySlug("test-holiday");
    expect(row?.updatedAt).toBe(authoredAt);
    expect(row?.createdAt).toBe(authoredAt);
  });

  it("is a no-op when the stored version already matches", async () => {
    await seedHolidayCatalog({ driver, version: 1, catalog: [entry()] });
    const before = await createHolidaysRepo(driver).getBySlug("test-holiday");

    const again = await seedHolidayCatalog({
      driver,
      version: 1,
      catalog: [entry({ name: "Renamed" })],
    });

    expect(again.seeded).toBe(false);
    const after = await createHolidaysRepo(driver).getBySlug("test-holiday");
    expect(after?.name).toBe(before?.name);
  });

  it("re-seeds when the catalog version is bumped", async () => {
    await seedHolidayCatalog({ driver, version: 1, catalog: [entry()] });
    await seedHolidayCatalog({
      driver,
      version: 2,
      catalog: [entry({ name: "Renamed", authoredAt: Date.UTC(2026, 5, 1) })],
    });
    const row = await createHolidaysRepo(driver).getBySlug("test-holiday");
    expect(row?.name).toBe("Renamed");
    expect(await createSyncStateRepo(driver).getHolidayCatalogVersion()).toBe(
      2,
    );
  });

  it("lets a newer synced row survive an older bundle's seed", async () => {
    // The regression the authored-timestamp rule exists to prevent: a device
    // that pulled catalog v4 over sync, then seeds its own older v3 bundle,
    // must not silently revert to v3.
    const holidays = createHolidaysRepo(driver);
    const newer = Date.UTC(2027, 0, 1);
    await holidays.upsertFromRemote({
      id: holidayIdFor("test-holiday"),
      slug: "test-holiday",
      name: "From a newer catalog",
      greeting: "a Happy Test",
      recurrence: '{"day":1,"month":3,"onInvalidDate":"skip","type":"fixed"}',
      durationDays: null,
      familyId: null,
      impliedByLocale: false,
      origin: "catalog",
      createdAt: newer,
      updatedAt: newer,
      deletedAt: null,
    });

    await seedHolidayCatalog({
      driver,
      version: 1,
      catalog: [entry({ name: "From an older bundle" })],
    });

    expect((await holidays.getBySlug("test-holiday"))?.name).toBe(
      "From a newer catalog",
    );
  });

  it("seeds a retired entry as a tombstone", async () => {
    // Absence cannot communicate removal to a device that already seeded the
    // row, so a retirement has to be an explicit tombstone in the bundle.
    const retiredAt = Date.UTC(2026, 6, 1);
    await seedHolidayCatalog({
      driver,
      version: 1,
      catalog: [entry({ retiredAt })],
    });
    const holidays = createHolidaysRepo(driver);
    expect(await holidays.getBySlug("test-holiday")).toBeUndefined();
    const dead = await holidays.getIncludingDeleted(
      holidayIdFor("test-holiday"),
    );
    expect(dead?.deletedAt).toBe(retiredAt);
  });
});

describe("observances", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  const HOLIDAY = holidayIdFor("christmas");
  const ALICE = "11111111-1111-4111-8111-111111111111";

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
  });

  afterEach(() => cleanup());

  it("derives its id from the key, so two devices converge on one row", async () => {
    // Not a cosmetic choice: the table carries a partial unique index on the
    // key, so random ids would make two offline devices asserting the same
    // thing collide on that index the moment they synced.
    const repo = createObservancesRepo(driver);
    await repo.setObservance(HOLIDAY, "person", ALICE, true);

    const [row] = await repo.listForHoliday(HOLIDAY);
    expect(row.id).toBe(observanceIdFor(HOLIDAY, "person", ALICE));
    expect(row.observes).toBe(true);
  });

  it("is idempotent — re-asserting does not duplicate", async () => {
    const repo = createObservancesRepo(driver);
    await repo.setObservance(HOLIDAY, "person", ALICE, true);
    await repo.setObservance(HOLIDAY, "person", ALICE, true);
    expect(await repo.listForHoliday(HOLIDAY)).toHaveLength(1);
  });

  it("stores an explicit `false` as an override, distinct from no row", async () => {
    const repo = createObservancesRepo(driver);
    await repo.setObservance(HOLIDAY, "person", ALICE, false);
    const [row] = await repo.listForHoliday(HOLIDAY);
    expect(row.observes).toBe(false);
  });

  it("clears back to the implicit answer with null, leaving no row", async () => {
    // Research §2.2: a row exists ONLY where it diverges from the implicit
    // answer, so agreeing again is a delete rather than a redundant write.
    const repo = createObservancesRepo(driver);
    await repo.setObservance(HOLIDAY, "person", ALICE, true);
    await repo.setObservance(HOLIDAY, "person", ALICE, null);
    expect(await repo.listForHoliday(HOLIDAY)).toEqual([]);
  });

  it("revives a cleared observance instead of colliding on the unique index", async () => {
    const repo = createObservancesRepo(driver);
    await repo.setObservance(HOLIDAY, "person", ALICE, true);
    await repo.setObservance(HOLIDAY, "person", ALICE, null);
    await repo.setObservance(HOLIDAY, "person", ALICE, true);
    const rows = await repo.listForHoliday(HOLIDAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].observes).toBe(true);
  });

  it("lists by bearer, for a person's own page", async () => {
    const repo = createObservancesRepo(driver);
    await repo.setObservance(HOLIDAY, "person", ALICE, true);
    expect(await repo.listForBearer("person", ALICE)).toHaveLength(1);
  });

  it("clears every observance of a deleted bearer", async () => {
    const repo = createObservancesRepo(driver);
    await repo.setObservance(HOLIDAY, "person", ALICE, true);
    await repo.removeAllForBearer("person", ALICE);
    expect(await repo.listForBearer("person", ALICE)).toEqual([]);
  });
});

describe("hidden holidays", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  const HOLIDAY = holidayIdFor("us-mothers-day");
  const ALICE = "11111111-1111-4111-8111-111111111111";

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
  });

  afterEach(() => cleanup());

  it("hides and unhides, idempotently", async () => {
    const repo = createHiddenHolidaysRepo(driver);
    await repo.setHidden(HOLIDAY, true);
    await repo.setHidden(HOLIDAY, true);
    expect(await repo.listHiddenIds()).toEqual(new Set([HOLIDAY]));

    await repo.setHidden(HOLIDAY, false);
    expect(await repo.listHiddenIds()).toEqual(new Set());

    await repo.setHidden(HOLIDAY, true);
    expect(await repo.listHiddenIds()).toEqual(new Set([HOLIDAY]));
  });

  it("never destroys observances — unhiding restores them", async () => {
    // Mother's Day is the holiday people hide for painful reasons, so a hide
    // that quietly deleted the underlying data would be worse than a bug.
    const observances = createObservancesRepo(driver);
    const hidden = createHiddenHolidaysRepo(driver);
    await observances.setObservance(HOLIDAY, "person", ALICE, true);

    await hidden.setHidden(HOLIDAY, true);
    expect(await observances.listForHoliday(HOLIDAY)).toHaveLength(1);

    await hidden.setHidden(HOLIDAY, false);
    expect(await observances.listForHoliday(HOLIDAY)).toHaveLength(1);
  });
});
