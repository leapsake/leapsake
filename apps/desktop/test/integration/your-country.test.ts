import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let core: CoreApi;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  core = createCore(driver, { phoneRegion: "US" });
});

afterEach(() => {
  cleanup();
});

async function addAddress(ownerId: string, country: string | null) {
  await core.contactMethods.postals.create({
    ownerType: "person",
    ownerId,
    label: "Home",
    locality: "Bedford Falls",
    country,
  });
}

describe("your country", () => {
  it("starts as this device's region", async () => {
    expect(await core.preferences.getYourCountry()).toEqual({
      country: "US",
      fromAddress: false,
    });
  });

  it("is what you choose", async () => {
    await core.preferences.setCountry("CA");
    expect((await core.preferences.getYourCountry()).country).toBe("CA");
  });

  it("is your own address's country, whatever the setting", async () => {
    const george = await core.people.create(
      { firstName: "George", lastName: "Bailey" },
      [],
    );
    await core.self.set(george.id);
    await addAddress(george.id, null);
    await addAddress(george.id, "IE");
    await core.preferences.setCountry("CA");

    expect(await core.preferences.getYourCountry()).toEqual({
      country: "IE",
      fromAddress: true,
    });
  });

  it("ignores the address of someone who isn't you", async () => {
    const mary = await core.people.create(
      { firstName: "Mary", lastName: "Hatch" },
      [],
    );
    await addAddress(mary.id, "IE");
    expect((await core.preferences.getYourCountry()).country).toBe("US");
  });
});
