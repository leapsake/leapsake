import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SqliteDriver } from "../src/driver.js";
import { runMigrations } from "../src/migrations.js";
import { type PeopleRepo, createPeopleRepo } from "../src/people-repo.js";
import { type PetsRepo, createPetsRepo } from "../src/pets-repo.js";
import {
  type SearchService,
  createSearchService,
} from "../src/search-service.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

let db: DatabaseSync;
let driver: SqliteDriver;
let people: PeopleRepo;
let pets: PetsRepo;
let search: SearchService;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  people = createPeopleRepo(driver);
  pets = createPetsRepo(driver);
  search = createSearchService(driver);
});

afterEach(() => {
  db.close();
});

/** Titles of the hits, in result order. */
async function titles(term: string): Promise<string[]> {
  const hits = await search.query(term);
  return hits.map((h) => h.title);
}

describe("searchService", () => {
  it("returns nothing for queries below the minimum length", async () => {
    await people.create({ firstName: "Jo", lastName: "Smith" });
    expect(await search.query("")).toEqual([]);
    expect(await search.query("j")).toEqual([]);
  });

  it("matches names accent- and case-insensitively", async () => {
    await people.create({ firstName: "José", lastName: "Armisen" });
    expect(await titles("jose")).toEqual(["José Armisen"]);
    expect(await titles("JOSE")).toEqual(["José Armisen"]);
    expect(await titles("armi")).toEqual(["José Armisen"]);
  });

  it("matches pets by name like people", async () => {
    await pets.create({ name: "Rex" });
    const hits = await search.query("rex");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ entityType: "pet", title: "Rex" });
  });

  it("returns one row per entity even when several fields match", async () => {
    await people.create({ firstName: "Lee", lastName: "Lee" });
    const hits = await search.query("lee");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("Lee Lee");
  });

  it("orders by match quality: exact, then starts-with, then substring", async () => {
    // Substring (term inside a field, not at its start).
    await people.create({ firstName: "Anna", lastName: "Bajoen" });
    await people.create({ firstName: "Joelle", lastName: "Smith" }); // starts-with
    await people.create({ firstName: "Joe", lastName: "Smith" }); // exact
    expect(await titles("joe")).toEqual([
      "Joe Smith",
      "Joelle Smith",
      "Anna Bajoen",
    ]);
  });

  it("breaks ties alphabetically within a match-quality bucket", async () => {
    await people.create({ firstName: "Joe", lastName: "Baker" });
    await people.create({ firstName: "Joe", lastName: "Adams" });
    expect(await titles("joe")).toEqual(["Joe Adams", "Joe Baker"]);
  });

  it("excludes soft-deleted people and pets", async () => {
    const person = await people.create({
      firstName: "Ghost",
      lastName: "Gone",
    });
    const pet = await pets.create({ name: "Ghostly" });
    await people.softDelete(person.id);
    await pets.softDelete(pet.id);
    expect(await search.query("ghost")).toEqual([]);
  });
});
