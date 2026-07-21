import { createHolidaysApi, seedHolidayCatalog } from "@leapsake/core";
import {
  createHiddenHolidaysRepo,
  createHolidaysRepo,
  createObservancesRepo,
  createPeopleRepo,
  createPetsRepo,
  holidayIdFor,
  runMigrations,
} from "@leapsake/data";
import type { SqliteDriver } from "@leapsake/data";
import type { CivilDate } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The holidays read API, composed over real seeded rows. This is the first place
 * the recurrence resolver meets rows that came out of the database rather than
 * the bundled module, so it is where "a rule this build can't parse" and "a
 * derivation base that hasn't arrived yet" have to degrade rather than throw.
 */
describe("holidays read API", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;

  /** A fixed "today" so occurrence assertions don't drift with the wall clock. */
  const TODAY: CivilDate = { year: 2026, month: 8, day: 1 };

  const api = () =>
    createHolidaysApi({
      holidays: createHolidaysRepo(driver),
      observances: createObservancesRepo(driver),
      hiddenHolidays: createHiddenHolidaysRepo(driver),
      people: createPeopleRepo(driver),
      pets: createPetsRepo(driver),
      driver,
      today: () => TODAY,
    });

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
    await seedHolidayCatalog({ driver });
  });

  afterEach(() => cleanup());

  it("resolves each seeded row's next occurrence", async () => {
    const list = await api().list();
    const bySlug = new Map(list.map((h) => [h.slug, h]));

    // From 2026-08-01: all of these are still ahead in 2026.
    expect(bySlug.get("us-labor-day")?.nextOccurrence).toBe("2026-09-07");
    expect(bySlug.get("us-halloween")?.nextOccurrence).toBe("2026-10-31");
    expect(bySlug.get("us-thanksgiving")?.nextOccurrence).toBe("2026-11-26");
    expect(bySlug.get("christmas")?.nextOccurrence).toBe("2026-12-25");
    // …and these have passed, so they roll to next year.
    expect(bySlug.get("us-independence-day")?.nextOccurrence).toBe(
      "2027-07-04",
    );
    expect(bySlug.get("western-easter")?.nextOccurrence).toBe("2027-03-28");
  });

  it("derives an occurrence through a derivation edge", async () => {
    // Good Friday is Easter − 2, resolved over synced rows rather than the
    // bundled catalog — the path that only exists once the rows are real.
    const list = await api().list();
    const goodFriday = list.find((h) => h.slug === "western-good-friday");
    expect(goodFriday?.nextOccurrence).toBe("2027-03-26");
  });

  it("orders soonest-first, sinking undated and hidden entries", async () => {
    const list = await api().list();
    const dated = list.filter((h) => h.nextOccurrence !== null && !h.hidden);
    const sorted = [...dated].sort((a, b) =>
      (a.nextOccurrence ?? "") < (b.nextOccurrence ?? "") ? -1 : 1,
    );
    expect(dated.map((h) => h.slug)).toEqual(sorted.map((h) => h.slug));
  });

  it("reports no date for a rule this build cannot parse, without throwing", async () => {
    // Rule-type skew: a peer on a newer catalog sends a rule shape this code
    // predates. The row must survive and stay listed — only its date is lost.
    const holidays = createHolidaysRepo(driver);
    const now = Date.UTC(2026, 0, 1);
    await holidays.upsertFromRemote({
      id: holidayIdFor("from-the-future"),
      slug: "from-the-future",
      name: "From The Future",
      greeting: "a Happy Future",
      recurrence: '{"type":"hebrew-calendar","anchor":"5786-03-01"}',
      durationDays: null,
      familyId: null,
      impliedByLocale: false,
      origin: "catalog",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    const list = await api().list();
    const row = list.find((h) => h.slug === "from-the-future");
    expect(row).toBeDefined();
    expect(row?.nextOccurrence).toBeNull();
  });

  it("reports no date when a derivation base has not arrived yet", async () => {
    // Sync applies rows one at a time across paginated batches with no
    // cross-table transaction, so a derived holiday genuinely can land before
    // the entry it derives from.
    const holidays = createHolidaysRepo(driver);
    const now = Date.UTC(2026, 0, 1);
    await holidays.upsertFromRemote({
      id: holidayIdFor("orphan-observance"),
      slug: "orphan-observance",
      name: "Orphan",
      greeting: "a Happy Orphan",
      recurrence: '{"days":-2,"from":"not-here-yet","type":"offset"}',
      durationDays: null,
      familyId: null,
      impliedByLocale: false,
      origin: "catalog",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    const row = (await api().list()).find(
      (h) => h.slug === "orphan-observance",
    );
    expect(row?.nextOccurrence).toBeNull();
  });

  it("counts explicit observers, ignoring explicit non-observers", async () => {
    const christmas = holidayIdFor("christmas");
    const observances = createObservancesRepo(driver);
    await observances.setObservance(
      christmas,
      "person",
      "11111111-1111-4111-8111-111111111111",
      true,
    );
    // An explicit `false` is an override — a statement that the bearer does NOT
    // observe — so it must not inflate the count.
    await observances.setObservance(
      christmas,
      "person",
      "22222222-2222-4222-8222-222222222222",
      false,
    );

    const row = (await api().list()).find((h) => h.slug === "christmas");
    expect(row?.observerCount).toBe(1);
  });

  it("keeps a hidden holiday listed, so it can be unhidden", async () => {
    const mothersDay = holidayIdFor("us-mothers-day");
    await createHiddenHolidaysRepo(driver).setHidden(mothersDay, true);

    const list = await api().list();
    const row = list.find((h) => h.slug === "us-mothers-day");
    expect(row?.hidden).toBe(true);
    // Sorted last, but present.
    expect(list.at(-1)?.slug).toBe("us-mothers-day");
  });

  it("returns a detail view with several upcoming dates", async () => {
    const detail = await api().get(holidayIdFor("christmas"));
    expect(detail?.name).toBe("Christmas");
    expect(detail?.greeting).toBe("a Merry Christmas");
    expect(detail?.upcoming).toEqual(["2026-12-25", "2027-12-25"]);
  });

  it("carries the multi-day duration through to the detail view", async () => {
    const detail = await api().get(holidayIdFor("hanukkah"));
    expect(detail?.durationDays).toBe(8);
  });

  it("returns undefined for an unknown id", async () => {
    expect(await api().get(holidayIdFor("no-such-holiday"))).toBeUndefined();
  });
});
