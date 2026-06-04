import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SqliteDriver } from "../src/driver.js";
import { runMigrations } from "../src/migrations.js";
import { type PetsRepo, createPetsRepo } from "../src/pets-repo.js";
import { betterSqlite3Driver } from "./better-sqlite3-driver.js";

let db: Database.Database;
let driver: SqliteDriver;
let repo: PetsRepo;

beforeEach(async () => {
  db = new Database(":memory:");
  driver = betterSqlite3Driver(db);
  await runMigrations(driver);
  repo = createPetsRepo(driver);
});

afterEach(() => {
  db.close();
});

describe("petsRepo", () => {
  it("creates a pet with a uuid, timestamps, and null deletedAt", async () => {
    const pet = await repo.create({ name: "Rex" });
    expect(pet.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(pet.name).toBe("Rex");
    expect(pet.createdAt).toBeGreaterThan(0);
    expect(pet.updatedAt).toBe(pet.createdAt);
    expect(pet.deletedAt).toBeNull();
  });

  it("persists and retrieves a created pet", async () => {
    const created = await repo.create({ name: "Whiskers" });
    const fetched = await repo.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("lists pets excluding soft-deleted ones, ordered by name", async () => {
    await repo.create({ name: "Apollo" });
    const zeus = await repo.create({ name: "Zeus" });
    await repo.softDelete(zeus.id);

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Apollo");
  });

  it("updates a pet and bumps updatedAt", async () => {
    const created = await repo.create({ name: "Rex" });
    // Ensure a later millisecond so updatedAt is observably newer.
    await new Promise((resolve) => setTimeout(resolve, 2));

    const updated = await repo.update(created.id, { name: "Rexy" });
    expect(updated?.name).toBe("Rexy");
    expect(updated?.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it("returns undefined when updating a missing or deleted pet", async () => {
    expect(
      await repo.update(crypto.randomUUID(), { name: "X" }),
    ).toBeUndefined();

    const created = await repo.create({ name: "Rex" });
    await repo.softDelete(created.id);
    expect(await repo.update(created.id, { name: "X" })).toBeUndefined();
  });

  it("hides a soft-deleted pet from get", async () => {
    const created = await repo.create({ name: "Rex" });
    await repo.softDelete(created.id);
    expect(await repo.get(created.id)).toBeUndefined();
  });
});
