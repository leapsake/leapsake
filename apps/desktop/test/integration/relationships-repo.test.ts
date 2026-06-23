import type { CreateRelationshipInput } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type RelationshipsRepo,
  type SqliteDriver,
  createRelationshipsRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: RelationshipsRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createRelationshipsRepo(driver);
});

afterEach(() => {
  cleanup();
});

/** A person↔person parent/child relationship input between two ids. */
function parentChild(
  aId: string,
  bId: string,
  over: Partial<CreateRelationshipInput> = {},
): CreateRelationshipInput {
  return {
    aType: "person",
    aId,
    aRole: "parent",
    bType: "person",
    bId,
    bRole: "child",
    ...over,
  };
}

describe("relationshipsRepo", () => {
  it("creates a relationship with a uuid, timestamps, and null deletedAt", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const rel = await repo.create(parentChild(a, b));

    expect(rel.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rel.aId).toBe(a);
    expect(rel.aRole).toBe("parent");
    expect(rel.bRole).toBe("child");
    expect(rel.createdAt).toBeGreaterThan(0);
    expect(rel.updatedAt).toBe(rel.createdAt);
    expect(rel.deletedAt).toBeNull();
  });

  it("persists and retrieves a created relationship", async () => {
    const created = await repo.create(
      parentChild(crypto.randomUUID(), crypto.randomUUID()),
    );
    expect(await repo.get(created.id)).toEqual(created);
  });

  it("lists relationships for an entity on either side", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await repo.create(parentChild(a, b));

    // `a` is the a-side, `b` is the b-side; both see the relationship.
    expect(await repo.listForEntity("person", a)).toHaveLength(1);
    expect(await repo.listForEntity("person", b)).toHaveLength(1);
  });

  it("allows multiple relationships between the same pair", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await repo.create(parentChild(a, b));
    await repo.create(
      parentChild(a, b, { aRole: "coworker", bRole: "coworker" }),
    );

    expect(await repo.listForEntity("person", a)).toHaveLength(2);
  });

  it("removeAllForEntity soft-deletes only relationships touching that entity", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const c = crypto.randomUUID();
    await repo.create(parentChild(a, b));
    await repo.create(parentChild(a, c));
    const unrelated = await repo.create(parentChild(b, c));

    await repo.removeAllForEntity("person", a);

    expect(await repo.listForEntity("person", a)).toHaveLength(0);
    // The b↔c relationship, which never involved `a`, survives.
    expect(await repo.get(unrelated.id)).toBeDefined();
    expect(await repo.listForEntity("person", b)).toHaveLength(1);
  });

  it("excludes soft-deleted relationships from get and listForEntity", async () => {
    const a = crypto.randomUUID();
    const rel = await repo.create(parentChild(a, crypto.randomUUID()));

    await repo.softDelete(rel.id);

    expect(await repo.get(rel.id)).toBeUndefined();
    expect(await repo.listForEntity("person", a)).toHaveLength(0);
  });

  it("updates roles and a note, bumping updatedAt", async () => {
    const created = await repo.create(
      parentChild(crypto.randomUUID(), crypto.randomUUID()),
    );
    await new Promise((resolve) => setTimeout(resolve, 2));

    const updated = await repo.update(created.id, {
      aRole: "other",
      aRoleNote: "mentor",
      bRole: "other",
      bRoleNote: "mentee",
    });

    expect(updated?.aRole).toBe("other");
    expect(updated?.aRoleNote).toBe("mentor");
    expect(updated?.bRoleNote).toBe("mentee");
    expect(updated?.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it("returns undefined when updating a missing relationship", async () => {
    expect(
      await repo.update(crypto.randomUUID(), { aRole: "friend" }),
    ).toBeUndefined();
  });

  it("rejects a role its holder type cannot hold", async () => {
    await expect(
      repo.create({
        aType: "pet",
        aId: crypto.randomUUID(),
        aRole: "owner", // owner must be a person
        bType: "pet",
        bId: crypto.randomUUID(),
        bRole: "pet",
      }),
    ).rejects.toThrow();

    // …and the mirror: a person can't hold the `pet` role.
    await expect(
      repo.create({
        aType: "person",
        aId: crypto.randomUUID(),
        aRole: "pet", // pet must be a pet
        bType: "person",
        bId: crypto.randomUUID(),
        bRole: "owner",
      }),
    ).rejects.toThrow();
  });

  it("round-trips a person↔pet owner/pet relationship", async () => {
    const person = crypto.randomUUID();
    const pet = crypto.randomUUID();
    const created = await repo.create({
      aType: "person",
      aId: person,
      aRole: "owner",
      bType: "pet",
      bId: pet,
      bRole: "pet",
    });

    expect(await repo.get(created.id)).toEqual(created);
    // Visible from both the person side and the pet side.
    expect(await repo.listForEntity("person", person)).toHaveLength(1);
    expect(await repo.listForEntity("pet", pet)).toHaveLength(1);
  });

  it("allows a pet↔pet sibling relationship", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const created = await repo.create({
      aType: "pet",
      aId: a,
      aRole: "sibling",
      bType: "pet",
      bId: b,
      bRole: "sibling",
    });

    expect(await repo.get(created.id)).toEqual(created);
    expect(await repo.listForEntity("pet", a)).toHaveLength(1);
    expect(await repo.listForEntity("pet", b)).toHaveLength(1);
  });
});
