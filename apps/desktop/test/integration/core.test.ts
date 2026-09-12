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
  core = createCore(driver);
});

afterEach(() => {
  cleanup();
});

/**
 * Decorate a driver so any `run` whose SQL matches `pattern` throws, letting a
 * test force a mid-transaction failure. `transaction` is inherited unchanged, so
 * BEGIN/ROLLBACK still run against the same underlying db.
 */
function failOnSql(base: SqliteDriver, pattern: RegExp): SqliteDriver {
  return {
    ...base,
    run(sql, params) {
      if (pattern.test(sql)) throw new Error("injected failure");
      return base.run(sql, params);
    },
  };
}

/** Count not-soft-deleted rows for white-box cascade assertions. */
async function activeRows(table: string): Promise<number> {
  const row = await driver.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL`,
  );
  return row!.n;
}

describe("createCore — transactional writes", () => {
  it("commits a person and its tags together", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      ["Friend", "Colleague"],
    );

    expect(await core.people.get(jane.id)).toBeDefined();
    const tags = await core.tags.listForPerson(jane.id);
    expect(tags.map((t) => t.name).toSorted()).toEqual(["Colleague", "Friend"]);
  });

  it("commits a pet and its tags together", async () => {
    const jimmy = await core.pets.create({ name: "Jimmy" }, ["GoodBoy"]);

    expect(await core.pets.get(jimmy.id)).toBeDefined();
    expect((await core.tags.listForPet(jimmy.id)).map((t) => t.name)).toEqual([
      "GoodBoy",
    ]);
  });

  it("rolls back both the person and its tags when the tag write fails", async () => {
    const failing = createCore(failOnSql(driver, /taggings/i));

    await expect(
      failing.people.create({ firstName: "Jane", lastName: "Wainwright" }, [
        "Friend",
      ]),
    ).rejects.toThrow();

    // Neither the person nor any tag survived — the whole transaction unwound.
    expect(await core.people.list()).toHaveLength(0);
    expect(await activeRows("tags")).toBe(0);
    expect(await activeRows("taggings")).toBe(0);
  });

  it("rolls back an update and its tag changes when the tag write fails", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      ["Friend"],
    );
    const failing = createCore(failOnSql(driver, /taggings/i));

    await expect(
      failing.people.update(jane.id, { firstName: "Janie" }, ["Family"]),
    ).rejects.toThrow();

    // The name change and the tag swap both unwound.
    expect((await core.people.get(jane.id))?.firstName).toBe("Jane");
    expect((await core.tags.listForPerson(jane.id)).map((t) => t.name)).toEqual(
      ["Friend"],
    );
  });
});

describe("createCore — cascade soft-delete", () => {
  it("cascades a person delete across every fact that references it", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      ["Friend"],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      [],
    );
    await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "parent",
      bType: "person",
      bId: harry.id,
      bRole: "child",
    });
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: jane.id,
      year: 1990,
      month: 1,
      day: 1,
    });
    await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: jane.id,
      label: "home",
      address: "jane@example.com",
    });
    await core.kinship.dismiss("person", jane.id, "person", harry.id, "child");

    await core.people.softDelete(jane.id);

    expect(await core.people.get(jane.id)).toBeUndefined();
    expect(await core.tags.listForPerson(jane.id)).toHaveLength(0);
    expect(
      await core.relationships.listForEntity("person", jane.id),
    ).toHaveLength(0);
    expect(await core.milestones.listForBearer("person", jane.id)).toHaveLength(
      0,
    );
    expect(
      await core.contactMethods.listForOwner("person", jane.id),
    ).toHaveLength(0);
    expect(await activeRows("relationship_dismissals")).toBe(0);
  });

  it("cascades a pet delete across tags, relationships, and milestones", async () => {
    const owner = await core.people.create(
      { firstName: "William", lastName: "Bailey" },
      [],
    );
    const jimmy = await core.pets.create({ name: "Jimmy" }, ["GoodBoy"]);
    await core.relationships.create({
      aType: "person",
      aId: owner.id,
      aRole: "owner",
      bType: "pet",
      bId: jimmy.id,
      bRole: "pet",
    });
    await core.milestones.create({
      kind: "birthday",
      bearerType: "pet",
      bearerId: jimmy.id,
      year: 2018,
      month: 5,
      day: 4,
    });

    await core.pets.softDelete(jimmy.id);

    expect(await core.pets.get(jimmy.id)).toBeUndefined();
    expect(await core.tags.listForPet(jimmy.id)).toHaveLength(0);
    expect(
      await core.relationships.listForEntity("pet", jimmy.id),
    ).toHaveLength(0);
    expect(await core.milestones.listForBearer("pet", jimmy.id)).toHaveLength(
      0,
    );
  });
});

describe("createCore — relationships.listForEntity", () => {
  it("orients each row to the subject and resolves the other end", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const sam = await core.people.create(
      { firstName: "Sam", lastName: "Wainwright" },
      [],
    );
    await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "parent",
      bType: "person",
      bId: sam.id,
      bRole: "child",
    });

    const [fromJane] = await core.relationships.listForEntity(
      "person",
      jane.id,
    );
    expect(fromJane.otherId).toBe(sam.id);
    expect(fromJane.otherLabel).toBe("Sam Wainwright");
    expect(fromJane.otherRole).toBe("child");

    // The same row, oriented to the other subject, flips to the parent end.
    const [fromJohn] = await core.relationships.listForEntity("person", sam.id);
    expect(fromJohn.otherId).toBe(jane.id);
    expect(fromJohn.otherLabel).toBe("Jane Wainwright");
    expect(fromJohn.otherRole).toBe("parent");
  });

  it("skips a neighbor whose other end no longer exists", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    // The b-side id was never a real person, so resolveLabel returns undefined.
    await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "parent",
      bType: "person",
      bId: crypto.randomUUID(),
      bRole: "child",
    });

    expect(
      await core.relationships.listForEntity("person", jane.id),
    ).toHaveLength(0);
  });
});

describe("createCore — tag fan-out", () => {
  it("returns the people and pets sharing a tag, and drops deleted ones", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      ["Household"],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      ["Household"],
    );
    const jimmy = await core.pets.create({ name: "Jimmy" }, ["Household"]);
    const tagId = (await core.tags.listForPerson(jane.id))[0].id;

    expect(
      (await core.tags.peopleForTag(tagId)).map((p) => p.id).toSorted(),
    ).toEqual([jane.id, harry.id].toSorted());
    expect((await core.tags.petsForTag(tagId)).map((p) => p.id)).toEqual([
      jimmy.id,
    ]);

    // Deleting Harry removes his tagging, so the fan-out no longer returns him.
    await core.people.softDelete(harry.id);
    expect((await core.tags.peopleForTag(tagId)).map((p) => p.id)).toEqual([
      jane.id,
    ]);
  });
});

describe("createCore — milestones.timelineFor", () => {
  it("merges own milestones with a relationship's, annotated with the partner", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const sam = await core.people.create(
      { firstName: "Sam", lastName: "Wainwright" },
      [],
    );
    const rel = await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "spouse",
      bType: "person",
      bId: sam.id,
      bRole: "spouse",
    });
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: jane.id,
      year: 1990,
      month: 3,
      day: 9,
    });
    const wedding = await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: rel.id,
      year: 2020,
      month: 6,
      day: 1,
    });

    const timeline = await core.milestones.timelineFor("person", jane.id);
    expect(timeline).toHaveLength(2);
    const relEntry = timeline.find((e) => e.origin === "relationship");
    expect(relEntry?.milestone.id).toBe(wedding.id);
    expect(relEntry?.relationshipId).toBe(rel.id);
    expect(relEntry?.otherLabel).toBe("Sam Wainwright");
  });
});
