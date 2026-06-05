import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SqliteDriver } from "../src/driver.js";
import { runMigrations } from "../src/migrations.js";
import { type PeopleRepo, createPeopleRepo } from "../src/people-repo.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

let db: DatabaseSync;
let driver: SqliteDriver;
let repo: PeopleRepo;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  repo = createPeopleRepo(driver);
});

afterEach(() => {
  db.close();
});

describe("runMigrations", () => {
  it("creates the people table and bumps user_version", async () => {
    const version = await driver.get<{ user_version: number }>(
      "PRAGMA user_version",
    );
    expect(version?.user_version).toBe(7);
  });

  it("is idempotent on a second run", async () => {
    await runMigrations(driver);
    const version = await driver.get<{ user_version: number }>(
      "PRAGMA user_version",
    );
    expect(version?.user_version).toBe(7);
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
