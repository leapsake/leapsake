import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ContactMethodsRepo,
  createContactMethodsRepo,
} from "../src/contact-methods-repo.js";
import { type SqliteDriver } from "../src/driver.js";
import { runMigrations } from "../src/migrations.js";
import { type PetsRepo, createPetsRepo } from "../src/pets-repo.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

let db: DatabaseSync;
let driver: SqliteDriver;
let pets: PetsRepo;
let contacts: ContactMethodsRepo;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  pets = createPetsRepo(driver);
  contacts = createContactMethodsRepo(driver);
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

// The CRUD surface every repo gets from `createEntityRepo`. These pin the two
// behaviours the old hand-rolled-per-repo code had drifted on: a tombstone that
// strictly out-ranks the row even on a same-millisecond delete, and a
// `getIncludingDeleted` available on every entity (pets had none before).
describe("createEntityRepo shared CRUD", () => {
  it("soft-delete bumps updatedAt strictly past a same-millisecond create", async () => {
    // Freeze the clock so create and softDelete land in the same millisecond —
    // the merge-loser case the MAX(?, updated_at + 1) tombstone guards against.
    const t = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(t);

    const pet = await pets.create({ name: "Rex" });
    expect(pet.createdAt).toBe(t);
    expect(pet.updatedAt).toBe(t);

    await pets.softDelete(pet.id);

    const dead = await pets.getIncludingDeleted(pet.id);
    expect(dead?.deletedAt).toBe(t);
    // Strictly newer than the live row, so the tombstone wins whole-row LWW.
    expect(dead?.updatedAt).toBe(t + 1);
    expect(dead?.updatedAt).toBeGreaterThan(dead?.createdAt ?? 0);
  });

  it("getIncludingDeleted returns a soft-deleted row that get() hides", async () => {
    const pet = await pets.create({ name: "Bella" });
    await pets.softDelete(pet.id);

    expect(await pets.get(pet.id)).toBeUndefined();
    const dead = await pets.getIncludingDeleted(pet.id);
    expect(dead?.id).toBe(pet.id);
    expect(dead?.deletedAt).not.toBeNull();
  });

  it("applies the same tombstone guard to a contact-method kind", async () => {
    const t = 1_700_000_000_001;
    vi.spyOn(Date, "now").mockReturnValue(t);

    const email = await contacts.emails.create({
      ownerType: "person",
      ownerId: crypto.randomUUID(),
      label: "home",
      address: "a@b.com",
    });
    await contacts.emails.softDelete(email.id);

    const dead = await contacts.emails.getIncludingDeleted(email.id);
    expect(dead?.deletedAt).toBe(t);
    expect(dead?.updatedAt).toBe(t + 1);
    expect(await contacts.emails.get(email.id)).toBeUndefined();
  });

  it("applies the tombstone guard to a same-millisecond bulk cascade delete", async () => {
    // The predicate path (softDeleteWhere) a host entity's removeAllFor… uses.
    const t = 1_700_000_000_002;
    vi.spyOn(Date, "now").mockReturnValue(t);

    const ownerId = crypto.randomUUID();
    const email = await contacts.emails.create({
      ownerType: "person",
      ownerId,
      label: "home",
      address: "a@b.com",
    });
    await contacts.removeAllForOwner("person", ownerId);

    const dead = await contacts.emails.getIncludingDeleted(email.id);
    expect(dead?.deletedAt).toBe(t);
    expect(dead?.updatedAt).toBe(t + 1);
    expect(await contacts.emails.listForOwner("person", ownerId)).toHaveLength(
      0,
    );
  });
});
