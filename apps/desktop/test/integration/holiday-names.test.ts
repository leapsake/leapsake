import { createCore, seedHolidayCatalog } from "@leapsake/core";
import { holidayIdFor, runMigrations } from "@leapsake/data";
import type { SqliteDriver } from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

const US_THANKSGIVING = holidayIdFor("us-thanksgiving");
const CA_THANKSGIVING = holidayIdFor("ca-thanksgiving");

let driver: SqliteDriver;
let cleanup: () => void;
let core: ReturnType<typeof createCore>;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  await seedHolidayCatalog({ driver });
  core = createCore(driver, { phoneRegion: "US" });
});

afterEach(() => cleanup());

async function names() {
  const list = await core.holidays.list();
  const nameOf = (id: string) => list.find((h) => h.id === id)?.name;
  return [nameOf(US_THANKSGIVING), nameOf(CA_THANKSGIVING)];
}

describe("a holiday's name, from where you are", () => {
  it("leaves your own country's bare and names the other's", async () => {
    expect(await names()).toEqual(["Thanksgiving", "Thanksgiving (Canada)"]);
  });

  it("turns around when your country does", async () => {
    await core.preferences.setCountry("CA");
    expect(await names()).toEqual([
      "Thanksgiving (United States)",
      "Thanksgiving",
    ]);
  });

  it("names both where neither is yours", async () => {
    await core.preferences.setCountry("GB");
    expect(await names()).toEqual([
      "Thanksgiving (United States)",
      "Thanksgiving (Canada)",
    ]);
  });

  it("never names the country of a name no other holiday shares", async () => {
    await core.preferences.setCountry("GB");
    const list = await core.holidays.list();
    expect(list.find((h) => h.slug === "ca-canada-day")?.name).toBe(
      "Canada Day",
    );
  });

  it("is found by the country it names", async () => {
    const hits = await core.search.query("canada");
    expect(hits.map((h) => h.title)).toContain("Thanksgiving (Canada)");
  });

  it("names it the same on the holiday's own page", async () => {
    await core.preferences.setCountry("CA");
    const detail = await core.holidays.get(US_THANKSGIVING);
    expect(detail?.name).toBe("Thanksgiving (United States)");
  });
});
