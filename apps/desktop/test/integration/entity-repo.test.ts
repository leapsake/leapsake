import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ContactMethodsRepo,
  type MentionsRepo,
  type PetsRepo,
  type SqliteDriver,
  createContactMethodsRepo,
  createMentionsRepo,
  createPetsRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let pets: PetsRepo;
let contacts: ContactMethodsRepo;
let mentions: MentionsRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  pets = createPetsRepo(driver);
  contacts = createContactMethodsRepo(driver);
  mentions = createMentionsRepo(driver);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
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

    const pet = await pets.create({ name: "Jimmy" });
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

/**
 * `listActive()` — the whole-table read for anything that is not the sync
 * collector.
 *
 * It exists because the alternative is a trap: `listChangedSince(0)` reads like
 * "give me every row" and hands back tombstones as well, deliberately, since
 * sync has to propagate deletes. The export reaches for one of these, and only
 * one of them is safe (`packages/export/src/ports.ts`).
 */
describe("defineSyncable listActive", () => {
  it("answers live rows where listChangedSince(0) also answers tombstones", async () => {
    const live = await pets.create({ name: "Jimmy" });
    const gone = await pets.create({ name: "Bella" });
    await pets.softDelete(gone.id);

    expect((await pets.listActive()).map((p) => p.id)).toEqual([live.id]);
    // The contrast this method exists for — same table, same moment.
    expect((await pets.listChangedSince(0)).map((p) => p.id).sort()).toEqual(
      [live.id, gone.id].sort(),
    );
  });

  it("is the unnarrowed read: list() still hides an unpublished row", async () => {
    const now = Date.now();
    const shadow = await pets.insert({
      id: crypto.randomUUID(),
      name: "Shadow",
      gender: null,
      standing: "unpublished",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    // `list()` applies the repo's `listOnly` (PUBLISHED_SQL) on top of the
    // not-deleted rule; `listActive()` applies only the not-deleted rule.
    expect(await pets.list()).toEqual([]);
    expect((await pets.listActive()).map((p) => p.id)).toEqual([shadow.id]);
  });

  it("reaches a table with no entity repo at all", async () => {
    const reminderId = crypto.randomUUID();
    const violet = crypto.randomUUID();
    const harry = crypto.randomUUID();

    await mentions.setEntityMentions("reminder", reminderId, [
      { targetType: "person", targetId: violet },
      { targetType: "person", targetId: harry },
    ]);
    // Harry is edited out of the text: the row is tombstoned, not erased.
    await mentions.setEntityMentions("reminder", reminderId, [
      { targetType: "person", targetId: violet },
    ]);

    expect((await mentions.listActive()).map((m) => m.targetId)).toEqual([
      violet,
    ]);
    expect(await mentions.listChangedSince(0)).toHaveLength(2);
  });
});
