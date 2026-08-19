import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type PeopleRepo,
  type SqliteDriver,
  createPeopleRepo,
  migrations,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/** The version the runner should land on: the last (highest) migration. */
const LATEST_VERSION = migrations.at(-1)!.version;

let driver: SqliteDriver;
let cleanup: () => void;
let repo: PeopleRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createPeopleRepo(driver);
});

afterEach(() => {
  cleanup();
});

describe("runMigrations", () => {
  it("creates the people table and bumps user_version", async () => {
    const version = await driver.get<{ user_version: number }>(
      "PRAGMA user_version",
    );
    expect(version?.user_version).toBe(LATEST_VERSION);
  });

  it("is idempotent on a second run", async () => {
    await runMigrations(driver);
    const version = await driver.get<{ user_version: number }>(
      "PRAGMA user_version",
    );
    expect(version?.user_version).toBe(LATEST_VERSION);
  });
});

describe("peopleRepo", () => {
  it("creates a person with a uuid, timestamps, and null deletedAt", async () => {
    const person = await repo.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(person.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(person.firstName).toBe("Ada");
    expect(person.lastName).toBe("Lovelace");
    expect(person.createdAt).toBeGreaterThan(0);
    expect(person.updatedAt).toBe(person.createdAt);
    expect(person.deletedAt).toBeNull();
  });

  it("defaults middleName to null and persists a provided one", async () => {
    const noMiddle = await repo.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(noMiddle.middleName).toBeNull();

    const withMiddle = await repo.create({
      firstName: "Ada",
      middleName: "Byron",
      lastName: "Lovelace",
    });
    expect(withMiddle.middleName).toBe("Byron");
    expect((await repo.get(withMiddle.id))?.middleName).toBe("Byron");
  });

  it("persists and retrieves a created person", async () => {
    const created = await repo.create({
      firstName: "Grace",
      lastName: "Hopper",
    });
    const fetched = await repo.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("defaults gender to null and persists a provided one", async () => {
    const ungendered = await repo.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(ungendered.gender).toBeNull();

    const gendered = await repo.create({
      firstName: "Grace",
      lastName: "Hopper",
      gender: "female",
    });
    expect(gendered.gender).toBe("female");
    expect((await repo.get(gendered.id))?.gender).toBe("female");

    const updated = await repo.update(gendered.id, { gender: null });
    expect(updated?.gender).toBeNull();
  });

  it("lists people excluding soft-deleted ones, ordered by name", async () => {
    await repo.create({ firstName: "Ada", lastName: "Lovelace" });
    const hopper = await repo.create({
      firstName: "Grace",
      lastName: "Hopper",
    });
    await repo.softDelete(hopper.id);

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.lastName).toBe("Lovelace");
  });

  it("updates a person and bumps updatedAt", async () => {
    const created = await repo.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    // Ensure a later millisecond so updatedAt is observably newer.
    await new Promise((resolve) => setTimeout(resolve, 2));

    const updated = await repo.update(created.id, { lastName: "Byron" });
    expect(updated?.lastName).toBe("Byron");
    expect(updated?.firstName).toBe("Ada");
    expect(updated?.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it("returns undefined when updating a missing or deleted person", async () => {
    expect(
      await repo.update(crypto.randomUUID(), { firstName: "X" }),
    ).toBeUndefined();

    const created = await repo.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await repo.softDelete(created.id);
    expect(await repo.update(created.id, { firstName: "X" })).toBeUndefined();
  });

  it("hides a soft-deleted person from get", async () => {
    const created = await repo.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await repo.softDelete(created.id);
    expect(await repo.get(created.id)).toBeUndefined();
  });
});

// A person needs *some* name, not a first one and a last one. Two features want
// this — someone known only as a relation ("Jen"), and contact import, whose
// parser deliberately yields mononyms and organisation-only cards rather than
// inventing a surname — and both write through this repo.
describe("peopleRepo — partial names", () => {
  it("persists a person with only a first name", async () => {
    const created = await repo.create({ firstName: "Cher" });
    expect(created.lastName).toBeNull();
    expect(await repo.get(created.id)).toEqual(created);
  });

  it("persists a person with only a last name", async () => {
    const created = await repo.create({ lastName: "Davis" });
    expect(created.firstName).toBeNull();
    expect(await repo.get(created.id)).toEqual(created);
  });

  it("refuses a person with no name at all", async () => {
    await expect(repo.create({ gender: "female" })).rejects.toThrow();
  });

  // The rule lives on the row, so `update` enforces it against the *merged*
  // result — the update input itself can't, since a patch legitimately carries
  // no name. This is the check that stops a name being edited away to nothing.
  it("refuses an update that would erase every name", async () => {
    const created = await repo.create({ firstName: "Cher" });
    await expect(
      repo.update(created.id, { firstName: null }),
    ).rejects.toThrow();
    expect((await repo.get(created.id))?.firstName).toBe("Cher");
  });

  it("allows clearing one name part while another survives", async () => {
    const created = await repo.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const updated = await repo.update(created.id, { firstName: null });
    expect(updated?.firstName).toBeNull();
    expect(updated?.lastName).toBe("Lovelace");
  });

  // Ordering by "last_name, first_name" would file everyone without a surname
  // in a NULL block at the top, ahead of the alphabet. Each person sorts by
  // whichever part of their name they actually have.
  it("sorts a surname-less person among the surnames", async () => {
    await repo.create({ firstName: "Ada", lastName: "Lovelace" });
    await repo.create({ firstName: "Cher" });
    await repo.create({ firstName: "Grace", lastName: "Hopper" });

    const list = await repo.list();
    expect(list.map((p) => p.lastName ?? p.firstName)).toEqual([
      "Cher",
      "Hopper",
      "Lovelace",
    ]);
  });
});
