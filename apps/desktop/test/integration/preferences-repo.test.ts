import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type PreferencesRepo,
  type SqliteDriver,
  createPreferencesRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: PreferencesRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createPreferencesRepo(driver);
});

afterEach(() => {
  cleanup();
});

/** A second device's store, for convergence. */
async function otherDevice() {
  const other = makeEncryptedTestDriver();
  await runMigrations(other.driver);
  return { repo: createPreferencesRepo(other.driver), cleanup: other.cleanup };
}

describe("preferencesRepo — date format", () => {
  it("has no date format until one is chosen", async () => {
    expect(await repo.getDateFormat()).toBeNull();
  });

  it("keeps the latest choice in one row", async () => {
    await repo.setDateFormat("DD.MM.YYYY");
    await repo.setDateFormat("YYYY-MM-DD");

    expect(await repo.getDateFormat()).toBe("YYYY-MM-DD");
    const rows = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM preferences",
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("goes back to the default when cleared", async () => {
    await repo.setDateFormat("MM/DD/YYYY");
    await repo.setDateFormat(null);
    expect(await repo.getDateFormat()).toBeNull();
  });

  it("refuses a format that is not one of the choices", async () => {
    await expect(
      repo.setDateFormat("YY/M/D" as unknown as "MM/DD/YYYY"),
    ).rejects.toThrow();
  });

  it("converges two devices on the later choice, as one row", async () => {
    const phone = await otherDevice();
    try {
      await phone.repo.setDateFormat("DD/MM/YYYY");
      await new Promise((resolve) => setTimeout(resolve, 2));
      await repo.setDateFormat("D Month YYYY");

      // Each side receives the other's row.
      const [mine] = await repo.listChangedSince(0);
      const [theirs] = await phone.repo.listChangedSince(0);
      await repo.upsertFromRemote(theirs);
      await phone.repo.upsertFromRemote(mine);

      expect(await repo.getDateFormat()).toBe("D Month YYYY");
      expect(await phone.repo.getDateFormat()).toBe("D Month YYYY");
    } finally {
      phone.cleanup();
    }
  });
});

describe("preferencesRepo — your country", () => {
  it("has no country until one is seeded or chosen", async () => {
    expect(await repo.getCountry()).toBeNull();
  });

  it("takes the device region as a seed only while none is stored", async () => {
    await repo.seedCountry("CA");
    await repo.seedCountry("FR");
    expect(await repo.getCountry()).toBe("CA");

    await repo.setCountry("IE");
    await repo.seedCountry("FR");
    expect(await repo.getCountry()).toBe("IE");
  });

  it("ignores a region that is not a country", async () => {
    await repo.seedCountry("419");
    await repo.seedCountry(null);
    expect(await repo.getCountry()).toBeNull();
  });

  it("refuses a country that is not a code", async () => {
    await expect(repo.setCountry("France")).rejects.toThrow();
  });

  it("keeps the date format when the country is seeded", async () => {
    await repo.setDateFormat("DD.MM.YYYY");
    await repo.seedCountry("DE");
    expect(await repo.getDateFormat()).toBe("DD.MM.YYYY");
    expect(await repo.getCountry()).toBe("DE");
  });

  it("lets a choice on one device beat a later seed on another", async () => {
    const phone = await otherDevice();
    try {
      await repo.setCountry("FR");
      await new Promise((resolve) => setTimeout(resolve, 2));
      await phone.repo.seedCountry("US");

      const [mine] = await repo.listChangedSince(0);
      const [theirs] = await phone.repo.listChangedSince(0);
      await repo.upsertFromRemote(theirs);
      await phone.repo.upsertFromRemote(mine);

      expect(await repo.getCountry()).toBe("FR");
      expect(await phone.repo.getCountry()).toBe("FR");
    } finally {
      phone.cleanup();
    }
  });

  it("converges two seeds on one country", async () => {
    const phone = await otherDevice();
    try {
      await repo.seedCountry("GB");
      await new Promise((resolve) => setTimeout(resolve, 2));
      await phone.repo.seedCountry("US");

      const [mine] = await repo.listChangedSince(0);
      const [theirs] = await phone.repo.listChangedSince(0);
      await repo.upsertFromRemote(theirs);
      await phone.repo.upsertFromRemote(mine);

      expect(await repo.getCountry()).toBe("US");
      expect(await phone.repo.getCountry()).toBe("US");
    } finally {
      phone.cleanup();
    }
  });
});
