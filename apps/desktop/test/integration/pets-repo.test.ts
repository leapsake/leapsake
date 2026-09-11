import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type PetsRepo,
  type SqliteDriver,
  createPetsRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: PetsRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createPetsRepo(driver);
});

afterEach(() => {
  cleanup();
});

describe("petsRepo", () => {
  it("creates a pet with a uuid, timestamps, and null deletedAt", async () => {
    const pet = await repo.create({ name: "Jimmy" });
    expect(pet.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(pet.name).toBe("Jimmy");
    expect(pet.createdAt).toBeGreaterThan(0);
    expect(pet.updatedAt).toBe(pet.createdAt);
    expect(pet.deletedAt).toBeNull();
  });

  it("persists and retrieves a created pet", async () => {
    const created = await repo.create({ name: "Bells" });
    const fetched = await repo.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("defaults gender to null and persists a provided one", async () => {
    const ungendered = await repo.create({ name: "Jimmy" });
    expect(ungendered.gender).toBeNull();

    const gendered = await repo.create({ name: "Petals", gender: "female" });
    expect(gendered.gender).toBe("female");
    expect((await repo.get(gendered.id))?.gender).toBe("female");
  });

  it("lists pets excluding soft-deleted ones, ordered by name", async () => {
    await repo.create({ name: "Bells" });
    const petals = await repo.create({ name: "Petals" });
    await repo.softDelete(petals.id);

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Bells");
  });

  it("updates a pet and bumps updatedAt", async () => {
    const created = await repo.create({ name: "Jimmy" });
    // Ensure a later millisecond so updatedAt is observably newer.
    await new Promise((resolve) => setTimeout(resolve, 2));

    const updated = await repo.update(created.id, { name: "Jimmy the Raven" });
    expect(updated?.name).toBe("Jimmy the Raven");
    expect(updated?.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it("returns undefined when updating a missing or deleted pet", async () => {
    expect(
      await repo.update(crypto.randomUUID(), { name: "X" }),
    ).toBeUndefined();

    const created = await repo.create({ name: "Jimmy" });
    await repo.softDelete(created.id);
    expect(await repo.update(created.id, { name: "X" })).toBeUndefined();
  });

  it("hides a soft-deleted pet from get", async () => {
    const created = await repo.create({ name: "Jimmy" });
    await repo.softDelete(created.id);
    expect(await repo.get(created.id)).toBeUndefined();
  });
});
