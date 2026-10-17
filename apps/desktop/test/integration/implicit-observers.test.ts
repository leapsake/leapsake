import { createCore, seedHolidayCatalog } from "@leapsake/core";
import { holidayIdFor, runMigrations } from "@leapsake/data";
import type { SqliteDriver } from "@leapsake/data";
import type { CreatePersonInput } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

const CHRISTMAS = holidayIdFor("christmas");
const THANKSGIVING = holidayIdFor("us-thanksgiving");
const HANUKKAH = holidayIdFor("hanukkah");

let driver: SqliteDriver;
let cleanup: () => void;
let core: ReturnType<typeof createCore>;

beforeEach(async () => {
  // Christmas Day, so a day-of wish is due.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 11, 25, 12));
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  await seedHolidayCatalog({ driver });
  core = createCore(driver, { phoneRegion: "US" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function person(input: CreatePersonInput) {
  return core.people.create(input, []);
}

async function observes(holidayId: string, bearerId: string) {
  const observers = await core.holidays.listObservers(holidayId);
  return observers.find((o) => o.bearerId === bearerId)?.observes;
}

/** Every Christmas wish on Home. */
async function christmasTitles() {
  await core.reminders.regenerateSystem();
  return (await core.reminders.list())
    .filter((r) => r.source === "system")
    .map((r) => r.title ?? "")
    .filter((title) => title.includes("a Merry Christmas"));
}

describe("implicit observers", () => {
  it("keeps a holiday for whoever holds its religion", async () => {
    const mary = await person({ firstName: "Mary", religions: ["jewish"] });
    expect(await observes(HANUKKAH, mary.id)).toBe(true);
  });

  it("keeps a national holiday for whoever lives in your country", async () => {
    const george = await person({ firstName: "George" });
    expect(await observes(THANKSGIVING, george.id)).toBe(true);
  });

  it("goes by an address over your country", async () => {
    const george = await person({ firstName: "George" });
    await core.contactMethods.postals.create({
      ownerType: "person",
      ownerId: george.id,
      label: "Home",
      country: "FR",
    });
    expect(await observes(THANKSGIVING, george.id)).toBe(false);
  });

  it("counts implicit observers on the browse list", async () => {
    await person({ firstName: "George" });
    await person({ firstName: "Mary" });
    const list = await core.holidays.list();
    expect(list.find((h) => h.id === THANKSGIVING)?.observerCount).toBe(2);
  });

  it("never implies a pet or someone who has died", async () => {
    const jimmy = await core.pets.create({ name: "Jimmy" }, []);
    const harry = await person({ firstName: "Harry" });
    await core.milestones.create({
      kind: "death",
      bearerType: "person",
      bearerId: harry.id,
      year: 2020,
      month: 1,
      day: 1,
    });
    expect(await observes(THANKSGIVING, jimmy.id)).toBe(false);
    expect(await observes(THANKSGIVING, harry.id)).toBe(false);
  });

  it("lets “doesn’t observe” beat an affiliation", async () => {
    const george = await person({ firstName: "George" });
    await core.holidays.setObservers(THANKSGIVING, [
      { bearerType: "person", bearerId: george.id, observes: false },
    ]);
    expect(await observes(THANKSGIVING, george.id)).toBe(false);
  });

  it("shows on the person's own holidays", async () => {
    const george = await person({ firstName: "George" });
    const theirs = await core.holidays.listForBearer("person", george.id);
    const thanksgiving = theirs.find((h) => h.id === THANKSGIVING);
    expect(thanksgiving).toMatchObject({ explicit: null, observes: true });
  });
});

describe("the wish an implicit observer is due", () => {
  it("wishes everyone who keeps Christmas, by default", async () => {
    await person({ firstName: "Mary", lastName: "Hatch" });
    expect(await christmasTitles()).toEqual([
      expect.stringContaining("a Merry Christmas"),
    ]);
  });

  it("never wishes you", async () => {
    const george = await person({ firstName: "George", lastName: "Bailey" });
    await core.self.set(george.id);
    expect(await christmasTitles()).toEqual([]);
  });

  it("stops wishing someone once their wish is turned off", async () => {
    const mary = await person({ firstName: "Mary", lastName: "Hatch" });
    await core.holidays.setObservanceSchedule(CHRISTMAS, "person", mary.id, [
      { action: "wish", label: null, offsetDays: 0, enabled: false },
    ]);
    expect(await christmasTitles()).toEqual([]);
    // Turning it off says nothing about whether she keeps the day.
    expect(await observes(CHRISTMAS, mary.id)).toBe(true);
    const stored = await core.holidays.listObservers(CHRISTMAS);
    expect(stored.find((o) => o.bearerId === mary.id)?.explicit).toBeNull();
  });

  it("keeps someone observing once anything is turned on for them", async () => {
    const mary = await person({ firstName: "Mary", religions: ["christian"] });
    await core.preferences.setCountry("IN");
    await core.holidays.setObservanceSchedule(CHRISTMAS, "person", mary.id, [
      { action: "get:gift", label: null, offsetDays: 12, enabled: true },
    ]);
    await core.people.update(mary.id, { religions: [] }, []);
    expect(await observes(CHRISTMAS, mary.id)).toBe(true);
  });

  it("wishes nobody for a hidden holiday", async () => {
    await person({ firstName: "Mary", lastName: "Hatch" });
    await core.holidays.setHidden(CHRISTMAS, true);
    expect(await christmasTitles()).toEqual([]);
  });

  it("stops wishing someone who moves away", async () => {
    const mary = await person({ firstName: "Mary", lastName: "Hatch" });
    await core.contactMethods.postals.create({
      ownerType: "person",
      ownerId: mary.id,
      label: "Home",
      country: "IN",
    });
    expect(await christmasTitles()).toEqual([]);
  });
});
