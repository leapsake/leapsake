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

async function you(): Promise<string> {
  const george = await core.people.create(
    { firstName: "George", lastName: "Bailey" },
    [],
  );
  await core.self.set(george.id);
  return george.id;
}

describe("your country", () => {
  it("starts as this device's region", async () => {
    expect(await core.preferences.getYourCountry()).toEqual({
      country: "US",
      source: "device",
    });
  });

  it("is your own address's country over the device's region", async () => {
    const george = await you();
    await addAddress(george, null);
    await addAddress(george, "IE");

    expect(await core.preferences.getYourCountry()).toEqual({
      country: "IE",
      source: "address",
    });
  });

  it("is what you choose, whatever your address says", async () => {
    await addAddress(await you(), "IE");
    await core.preferences.setCountry("CA");

    expect(await core.preferences.getYourCountry()).toEqual({
      country: "CA",
      source: "chosen",
    });
  });

  it("goes back to your address when the choice is cleared", async () => {
    await addAddress(await you(), "IE");
    await core.preferences.setCountry("CA");
    await core.preferences.setCountry(null);

    expect(await core.preferences.getYourCountry()).toEqual({
      country: "IE",
      source: "address",
    });
  });

  it("goes back to the device's region with no address to go on", async () => {
    await core.preferences.setCountry("CA");
    await core.preferences.setCountry(null);

    expect(await core.preferences.getYourCountry()).toEqual({
      country: "US",
      source: "device",
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
