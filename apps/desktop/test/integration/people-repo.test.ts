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
      firstName: "Mary",
      lastName: "Bailey",
    });
    expect(person.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(person.firstName).toBe("Mary");
    expect(person.lastName).toBe("Bailey");
    expect(person.createdAt).toBeGreaterThan(0);
    expect(person.updatedAt).toBe(person.createdAt);
    expect(person.deletedAt).toBeNull();
  });

  it("defaults middleName to null and persists a provided one", async () => {
    const noMiddle = await repo.create({
      firstName: "Mary",
      lastName: "Bailey",
    });
    expect(noMiddle.middleName).toBeNull();

    const withMiddle = await repo.create({
      firstName: "Mary",
      middleName: "Hatch",
      lastName: "Bailey",
    });
    expect(withMiddle.middleName).toBe("Hatch");
    expect((await repo.get(withMiddle.id))?.middleName).toBe("Hatch");
  });

  it("persists and retrieves a created person", async () => {
    const created = await repo.create({
      firstName: "Henry",
      lastName: "Potter",
    });
    const fetched = await repo.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("defaults gender to null and persists a provided one", async () => {
    const ungendered = await repo.create({
      firstName: "Mary",
      lastName: "Bailey",
    });
    expect(ungendered.gender).toBeNull();

    const gendered = await repo.create({
      firstName: "Henry",
      lastName: "Potter",
      gender: "female",
    });
    expect(gendered.gender).toBe("female");
    expect((await repo.get(gendered.id))?.gender).toBe("female");

    const updated = await repo.update(gendered.id, { gender: null });
    expect(updated?.gender).toBeNull();
  });

  it("lists people excluding soft-deleted ones, ordered by name", async () => {
    await repo.create({ firstName: "Mary", lastName: "Bailey" });
    const potter = await repo.create({
      firstName: "Henry",
      lastName: "Potter",
    });
    await repo.softDelete(potter.id);

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.lastName).toBe("Bailey");
  });

  it("updates a person and bumps updatedAt", async () => {
    const created = await repo.create({
      firstName: "Mary",
      lastName: "Bailey",
    });
    // Ensure a later millisecond so updatedAt is observably newer.
    await new Promise((resolve) => setTimeout(resolve, 2));

    const updated = await repo.update(created.id, { lastName: "Hatch" });
    expect(updated?.lastName).toBe("Hatch");
    expect(updated?.firstName).toBe("Mary");
    expect(updated?.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it("returns undefined when updating a missing or deleted person", async () => {
    expect(
      await repo.update(crypto.randomUUID(), { firstName: "X" }),
    ).toBeUndefined();

    const created = await repo.create({
      firstName: "Mary",
      lastName: "Bailey",
    });
    await repo.softDelete(created.id);
    expect(await repo.update(created.id, { firstName: "X" })).toBeUndefined();
  });

  it("hides a soft-deleted person from get", async () => {
    const created = await repo.create({
      firstName: "Mary",
      lastName: "Bailey",
    });
    await repo.softDelete(created.id);
    expect(await repo.get(created.id)).toBeUndefined();
  });
});

// A person needs *some* name, not a first one and a last one. Two features want
// this — someone known only as a relation ("Ruth"), and contact import, whose
// parser deliberately yields mononyms and organisation-only cards rather than
// inventing a surname — and both write through this repo.
describe("peopleRepo — partial names", () => {
  it("persists a person with only a first name", async () => {
    const created = await repo.create({ firstName: "Zuzu" });
    expect(created.lastName).toBeNull();
    expect(await repo.get(created.id)).toEqual(created);
  });

  it("persists a person with only a last name", async () => {
    const created = await repo.create({ lastName: "Dakin" });
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
    const created = await repo.create({ firstName: "Zuzu" });
    await expect(
      repo.update(created.id, { firstName: null }),
    ).rejects.toThrow();
    expect((await repo.get(created.id))?.firstName).toBe("Zuzu");
  });

  it("allows clearing one name part while another survives", async () => {
    const created = await repo.create({
      firstName: "Mary",
      lastName: "Bailey",
    });
    const updated = await repo.update(created.id, { firstName: null });
    expect(updated?.firstName).toBeNull();
    expect(updated?.lastName).toBe("Bailey");
  });

  // Ordering by "last_name, first_name" would file everyone without a surname
  // in a NULL block at the top, ahead of the alphabet. Each person sorts by
  // whichever part of their name they actually have.
  it("sorts a surname-less person among the surnames", async () => {
    await repo.create({ firstName: "Mary", lastName: "Bailey" });
    await repo.create({ firstName: "Clarence" });
    await repo.create({ firstName: "Henry", lastName: "Potter" });

    const list = await repo.list();
    expect(list.map((p) => p.lastName ?? p.firstName)).toEqual([
      "Bailey",
      "Clarence",
      "Potter",
    ]);
  });
});

// An unpublished person exists only as a fact about a published one, so they are
// no part of the user's catalog — but they are ordinary, durable, replicating
// data, which is what separates them from a draft.
describe("peopleRepo — standing", () => {
  it("defaults a created person to published", async () => {
    const created = await repo.create({ firstName: "Mary", lastName: "L" });
    expect(created.standing).toBe("published");
  });

  it("leaves an unpublished person out of the catalog list", async () => {
    await repo.create({ firstName: "Ernie", lastName: "Bishop" });
    await repo.create({ firstName: "Ruth", standing: "unpublished" });

    expect((await repo.list()).map((p) => p.firstName)).toEqual(["Ernie"]);
  });

  // The page they appear on has to render them, and it reaches them by id — so
  // `list` narrowing must not narrow `get` with it.
  it("still returns an unpublished person by id", async () => {
    const ruth = await repo.create({
      firstName: "Ruth",
      standing: "unpublished",
    });
    expect(await repo.get(ruth.id)).toEqual(ruth);
  });

  it("reaches unpublished rows through an explicit query", async () => {
    await repo.create({ firstName: "Ruth", standing: "unpublished" });
    const found = await repo.listWhere({
      where: "standing = ?",
      params: ["unpublished"],
    });
    expect(found.map((p) => p.firstName)).toEqual(["Ruth"]);
  });

  // Sync collects through `listChangedSince`, not `list()`, which is what keeps
  // an unpublished person on every one of the user's devices. Being hidden from
  // the catalog is a reading rule, not a reason to withhold the row.
  it("offers an unpublished person to the sync collector", async () => {
    const ruth = await repo.create({
      firstName: "Ruth",
      standing: "unpublished",
    });
    const changed = await repo.listChangedSince(0);
    expect(changed.map((p) => p.id)).toContain(ruth.id);
  });

  it("promotes and demotes through a plain update", async () => {
    const ruth = await repo.create({
      firstName: "Ruth",
      standing: "unpublished",
    });

    const promoted = await repo.update(ruth.id, { standing: "published" });
    expect(promoted?.standing).toBe("published");
    expect((await repo.list()).map((p) => p.firstName)).toEqual(["Ruth"]);

    await repo.update(ruth.id, { standing: "unpublished" });
    expect(await repo.list()).toEqual([]);
  });

  // The bug this guards: `standingColumnSchema` carries a default, and a
  // defaulted schema fills itself in even under `.optional()`. An update input
  // built from it would stamp "published" onto every patch, so correcting an
  // unpublished person's spelling would publish them.
  it("does not republish an unpublished person on an unrelated edit", async () => {
    const ruth = await repo.create({
      firstName: "Ruth",
      standing: "unpublished",
    });

    const renamed = await repo.update(ruth.id, { lastName: "Dakin" });
    expect(renamed?.standing).toBe("unpublished");

    const gendered = await repo.update(ruth.id, { gender: "female" });
    expect(gendered?.standing).toBe("unpublished");
    expect(await repo.list()).toEqual([]);
  });
});
