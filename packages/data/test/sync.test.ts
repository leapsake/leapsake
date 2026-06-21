import { DatabaseSync } from "node:sqlite";
import type { SyncRow } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ContactMethodsRepo,
  createContactMethodsRepo,
} from "../src/contact-methods-repo.js";
import { createContentCipher } from "../src/content-cipher.js";
import {
  type DismissalsRepo,
  createDismissalsRepo,
} from "../src/dismissals-repo.js";
import type { SqliteDriver } from "../src/driver.js";
import { runMigrations } from "../src/migrations.js";
import {
  type MilestonesRepo,
  createMilestonesRepo,
} from "../src/milestones-repo.js";
import { type PeopleRepo, createPeopleRepo } from "../src/people-repo.js";
import { type PetsRepo, createPetsRepo } from "../src/pets-repo.js";
import {
  type RelationshipsRepo,
  createRelationshipsRepo,
} from "../src/relationships-repo.js";
import { type SyncEngine, createSyncEngine } from "../src/sync-engine.js";
import { createSyncStateRepo } from "../src/sync-state-repo.js";
import {
  type SyncTransport,
  createInMemoryTransport,
} from "../src/sync-transport.js";
import type { SyncableRepo } from "../src/syncable.js";
import { type TagsRepo, createTagsRepo } from "../src/tags-repo.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

/**
 * End-to-end sync of the **whole dataset** over the blind in-memory transport
 * (plans/encryption/sync.md). Two devices share one transport and a fixed master
 * key; the registry-driven engine seals whole rows under the MK, the relay only
 * ever carries ciphertext + metadata, and `resolveMerge` (whole-row LWW)
 * reconciles on apply. Proves the people core (create propagation, LWW
 * convergence, tombstone + resurrection, idempotent re-pull, the lost-update
 * window) and that the same per-table pattern now covers every other entity —
 * including the encrypted `milestone.note`, whose content keys never leave the
 * device, and the join/edge tables (taggings, relationships, dismissals).
 */

// A fixed 32-byte master key shared by both devices (one account, two devices).
const MK = new Uint8Array(32).fill(7);

/** A device: its own SQLite DB + the full set of domain repos. */
interface Device {
  db: DatabaseSync;
  driver: SqliteDriver;
  people: PeopleRepo;
  pets: PetsRepo;
  milestones: MilestonesRepo;
  relationships: RelationshipsRepo;
  dismissals: DismissalsRepo;
  tags: TagsRepo;
  contactMethods: ContactMethodsRepo;
}

async function makeDevice(): Promise<Device> {
  const db = new DatabaseSync(":memory:");
  const driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  const cipher = createContentCipher({ driver, masterKey: MK });
  return {
    db,
    driver,
    people: createPeopleRepo(driver),
    pets: createPetsRepo(driver),
    milestones: createMilestonesRepo(driver, cipher),
    relationships: createRelationshipsRepo(driver),
    dismissals: createDismissalsRepo(driver),
    tags: createTagsRepo(driver),
    contactMethods: createContactMethodsRepo(driver),
  };
}

/** Every table's {@link SyncableRepo} — the registry handed to the engine. */
function syncables(d: Device): SyncableRepo<SyncRow>[] {
  return [
    d.people,
    d.pets,
    d.milestones,
    d.relationships,
    d.dismissals,
    d.tags,
    d.tags.taggings,
    d.contactMethods.emails,
    d.contactMethods.phones,
    d.contactMethods.postals,
  ];
}

/**
 * Force a row's clock to a controlled value so LWW outcomes are deterministic
 * (repo writes stamp `Date.now()`, which we can't order precisely in a test).
 */
async function stamp(
  device: Device,
  table: string,
  id: string,
  updatedAt: number,
  opts: { createdAt?: number; deletedAt?: number | null } = {},
): Promise<void> {
  const row = await device.driver.get<{
    created_at: number;
    deleted_at: number | null;
  }>(`SELECT created_at, deleted_at FROM ${table} WHERE id = ?`, [id]);
  await device.driver.run(
    `UPDATE ${table} SET created_at = ?, updated_at = ?, deleted_at = ? WHERE id = ?`,
    [
      opts.createdAt ?? row?.created_at ?? updatedAt,
      updatedAt,
      opts.deletedAt ?? row?.deleted_at ?? null,
      id,
    ],
  );
}

describe("sync engine (all entities, in-memory transport)", () => {
  let transport: ReturnType<typeof createInMemoryTransport>;
  let A: Device;
  let B: Device;

  function engineFor(d: Device): SyncEngine {
    return createSyncEngine({ transport, masterKey: MK, repos: syncables(d) });
  }

  beforeEach(async () => {
    transport = createInMemoryTransport();
    A = await makeDevice();
    B = await makeDevice();
  });

  afterEach(() => {
    A.db.close();
    B.db.close();
  });

  // --- The allowlist guard: sync is opt-in, key tables must never leave. -----

  it("syncs exactly the opted-in tables — and never a device-local key table", () => {
    // This list is the allowlist. Adding a table here is the conscious "yes, this
    // may leave the device" step (syncable.ts recipe, step 4); a new entity that
    // is not registered simply does not sync. The device-local key tables
    // (content_key, key_wrap) must *never* appear — that is what keeps sync
    // zero-knowledge (model.md §3).
    const tables = syncables(A)
      .map((repo) => repo.table)
      .sort();
    expect(tables).toEqual([
      "email_addresses",
      "milestones",
      "people",
      "pets",
      "phone_numbers",
      "postal_addresses",
      "relationship_dismissals",
      "relationships",
      "taggings",
      "tags",
    ]);
    expect(tables).not.toContain("content_key");
    expect(tables).not.toContain("key_wrap");
    expect(tables).not.toContain("sync_state"); // device-local watermarks
    expect(tables).not.toContain("account"); // account identity (kdf salt + verifier)
    expect(tables).not.toContain("device"); // device registration
  });

  // --- People: the original core, now over the registry-driven engine. ------

  it("propagates a created row from one device to the other", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);

    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const hwmA = await engineA.push(0);
    expect(hwmA).toBe(ada.updatedAt);

    await engineB.pull(0);

    const onB = await B.people.get(ada.id);
    expect(onB).toEqual(ada); // identical fields and timestamps
  });

  it("persists watermarks so a fresh engine resumes instead of re-pulling from zero", async () => {
    // Record the `since` cursor each pull is invoked with, so we can observe
    // *where* a fresh engine resumes — the property caller-held marks can't give.
    const pulledSince: number[] = [];
    const base = createInMemoryTransport();
    const recording: SyncTransport = {
      push: (records) => base.push(records),
      pull: (since) => {
        pulledSince.push(since);
        return base.pull(since);
      },
    };
    const engine = (
      d: Device,
      syncState: ReturnType<typeof createSyncStateRepo>,
    ) =>
      createSyncEngine({
        transport: recording,
        masterKey: MK,
        repos: syncables(d),
        syncState,
      });

    const stateA = createSyncStateRepo(A.driver);
    const stateB = createSyncStateRepo(B.driver);

    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await engine(A, stateA).sync(); // pushes Ada, persists A's push HWM
    await engine(B, stateB).sync(); // pulls Ada, persists B's pull cursor
    expect(await B.people.get(ada.id)).toEqual(ada);

    const resumedCursor = await stateB.getPullCursor();
    expect(resumedCursor).toBeGreaterThan(0);

    // A *fresh* state repo + engine on the SAME driver — nothing kept in memory.
    const freshState = createSyncStateRepo(B.driver);
    expect(await freshState.getPullCursor()).toBe(resumedCursor); // durable
    const freshEngineB = engine(B, freshState);

    pulledSince.length = 0;
    await freshEngineB.sync();
    // It pulled from the persisted cursor, not from 0.
    expect(pulledSince).toEqual([resumedCursor]);

    // And a genuinely new row still flows to the resumed engine.
    const grace = await A.people.create({
      firstName: "Grace",
      lastName: "Hopper",
    });
    await engine(A, stateA).sync();
    await freshEngineB.sync();
    expect(await B.people.get(grace.id)).toEqual(grace);
  });

  it("sync() reports the pull's applied count (the reactive-invalidation signal)", async () => {
    const engine = (
      d: Device,
      syncState: ReturnType<typeof createSyncStateRepo>,
    ) =>
      createSyncEngine({
        transport,
        masterKey: MK,
        repos: syncables(d),
        syncState,
      });
    const stateA = createSyncStateRepo(A.driver);
    const stateB = createSyncStateRepo(B.driver);

    await A.people.create({ firstName: "Ada", lastName: "Lovelace" });
    await engine(A, stateA).sync(); // push Ada to the shared transport

    // B's first sync pulls Ada — `applied > 0` is what tells a client to
    // revalidate the visible screen.
    const onB = await engine(B, stateB).sync();
    expect(onB.applied).toBeGreaterThan(0);

    // A second sync on the *converged author* is a genuine no-op pull (it already
    // pushed Ada, so its push HWM is past her) — `applied` is 0, so no pointless
    // revalidation fires. (A device that pulled a row it never pushed re-pushes it
    // once and pulls the echo back — the accepted imprecision, harmless.)
    const again = await engine(A, stateA).sync();
    expect(again.applied).toBe(0);
  });

  it("never exposes domain fields to the transport (only ciphertext + metadata)", async () => {
    const engineA = engineFor(A);
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await engineA.push(0);

    const { records } = await transport.pull(0);
    expect(records).toHaveLength(1);
    const [rec] = records;
    expect(rec.id).toBe(ada.id);
    expect(rec.table).toBe("people");
    expect(rec.updatedAt).toBe(ada.updatedAt);
    // The name never appears in the cleartext envelope, only inside ciphertext.
    const cleartext = JSON.stringify({
      id: rec.id,
      table: rec.table,
      updatedAt: rec.updatedAt,
      deletedAt: rec.deletedAt,
    });
    expect(cleartext).not.toContain("Lovelace");
    expect(rec.wrappedKey).toBeUndefined(); // reserved, unused this slice
  });

  it("converges on the higher-updatedAt row regardless of pull order (LWW)", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await stamp(A, "people", ada.id, 1000, { createdAt: 1000 });
    await engineA.push(0);
    let { cursor: cursorB } = await engineB.pull(0);

    // Concurrent edits: A is newer (3000), B is older (2000).
    await A.people.update(ada.id, { gender: "female" });
    await stamp(A, "people", ada.id, 3000, { createdAt: 1000 });
    await B.people.update(ada.id, { lastName: "Byron" });
    await stamp(B, "people", ada.id, 2000, { createdAt: 1000 });

    await engineA.push(1000); // push A's 3000 edit
    await engineB.push(1000); // push B's 2000 edit

    await engineA.pull(0);
    ({ cursor: cursorB } = await engineB.pull(cursorB));

    const expected = {
      id: ada.id,
      firstName: "Ada",
      middleName: null,
      lastName: "Lovelace", // A's row won wholesale
      gender: "female",
      createdAt: 1000,
      updatedAt: 3000,
      deletedAt: null,
    };
    expect(await A.people.getIncludingDeleted(ada.id)).toEqual(expected);
    expect(await B.people.getIncludingDeleted(ada.id)).toEqual(expected);
  });

  it("propagates a tombstone, and a later edit resurrects (LWW deletes)", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await stamp(A, "people", ada.id, 1000, { createdAt: 1000 });
    await engineA.push(0);
    await engineB.pull(0);

    // A deletes at 2000; tombstone propagates to B.
    await A.people.softDelete(ada.id);
    await stamp(A, "people", ada.id, 2000, {
      createdAt: 1000,
      deletedAt: 2000,
    });
    await engineA.push(1000);
    await engineB.pull(0);

    expect(await B.people.get(ada.id)).toBeUndefined(); // hidden from live reads
    const tombstone = await B.people.getIncludingDeleted(ada.id);
    expect(tombstone?.deletedAt).toBe(2000);

    // B edits at 3000 — a later write resurrects per LWW.
    await B.driver.run(
      "UPDATE people SET gender = ?, deleted_at = ?, updated_at = ? WHERE id = ?",
      ["female", null, 3000, ada.id],
    );
    await engineB.push(0);
    await engineA.pull(0);

    const onA = await A.people.get(ada.id);
    expect(onA?.deletedAt).toBeNull();
    expect(onA?.gender).toBe("female");
    expect(onA?.updatedAt).toBe(3000);
  });

  it("is idempotent: re-pulling the same cursor changes nothing", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await engineA.push(0);

    const { cursor: cursor1, applied: applied1 } = await engineB.pull(0);
    expect(applied1).toBe(1); // Ada delivered — the "changed" signal
    const before = await B.people.get(ada.id);
    const { cursor: cursor2, applied: applied2 } = await engineB.pull(cursor1);
    const after = await B.people.get(ada.id);

    expect(cursor2).toBe(cursor1); // nothing new delivered
    expect(applied2).toBe(0); // no-op pull reports nothing applied
    expect(after).toEqual(before);
    await engineB.pull(0);
    expect(await B.people.get(ada.id)).toEqual(before);
  });

  it("loses the lower-updatedAt field edit (the accepted lost-update window)", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await stamp(A, "people", ada.id, 1000, { createdAt: 1000 });
    await engineA.push(0);
    const { cursor: cursorB } = await engineB.pull(0);

    await A.people.update(ada.id, { gender: "female" }); // A: gender, ts 3000
    await stamp(A, "people", ada.id, 3000, { createdAt: 1000 });
    await B.people.update(ada.id, { middleName: "Augusta" }); // B: middleName, ts 2000
    await stamp(B, "people", ada.id, 2000, { createdAt: 1000 });

    await engineA.push(1000);
    await engineB.push(1000);
    await engineA.pull(0);
    await engineB.pull(cursorB);

    const onA = await A.people.getIncludingDeleted(ada.id);
    const onB = await B.people.getIncludingDeleted(ada.id);
    expect(onA).toEqual(onB); // still converged
    expect(onA?.gender).toBe("female");
    expect(onA?.middleName).toBeNull(); // the documented loss
  });

  // --- The other entities: the same per-table pattern. ----------------------

  it("propagates pets and converges them via LWW", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);

    const rex = await A.pets.create({ name: "Rex" });
    await stamp(A, "pets", rex.id, 1000, { createdAt: 1000 });
    await engineA.push(0);
    await engineB.pull(0);
    expect((await B.pets.get(rex.id))?.name).toBe("Rex"); // create propagated

    // Concurrent edits: A newer (3000) than B (2000) — A wins wholesale.
    await A.pets.update(rex.id, { gender: "male" });
    await stamp(A, "pets", rex.id, 3000, { createdAt: 1000 });
    await B.pets.update(rex.id, { name: "Rexington" });
    await stamp(B, "pets", rex.id, 2000, { createdAt: 1000 });

    await engineA.push(1000);
    await engineB.push(1000);
    await engineA.pull(0);
    await engineB.pull(0);

    const onA = await A.pets.get(rex.id);
    const onB = await B.pets.get(rex.id);
    expect(onA).toEqual(onB);
    expect(onA?.name).toBe("Rex"); // A's row won wholesale
    expect(onA?.gender).toBe("male");
  });

  it("syncs an encrypted milestone note while content keys never leave the device", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);

    const subjectId = crypto.randomUUID();
    const milestone = await A.milestones.create({
      kind: "birthday",
      subjectType: "person",
      subjectId,
      month: 6,
      day: 18,
      note: "secret picnic",
    });
    await engineA.push(0);

    // The transport carries only milestone records — never a content_key or
    // key_wrap row — and the note plaintext is nowhere in the cleartext envelope.
    const { records } = await transport.pull(0);
    expect(records.map((r) => r.table)).toEqual(["milestones"]);
    const [rec] = records;
    const metadata = JSON.stringify({
      id: rec.id,
      table: rec.table,
      updatedAt: rec.updatedAt,
      deletedAt: rec.deletedAt,
    });
    expect(metadata).not.toContain("picnic");

    await engineB.pull(0);

    // B decrypts the note under its own device-local content key.
    const onB = await B.milestones.get(milestone.id);
    expect(onB).toEqual(milestone);
    expect(onB?.note).toBe("secret picnic");

    // The content key B uses is its own (minted on apply), never synced: B holds
    // exactly one content wrap, and A's wrap was never pushed over the transport.
    const bWraps = await B.driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE wrapped_kind = 'content' AND deleted_at IS NULL",
    );
    expect(bWraps[0].n).toBe(1);
  });

  it("propagates a tag together with its tagging (join resolves on the peer)", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);

    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await A.tags.setEntityTags("person", ada.id, ["Friend"]);

    await engineA.push(0);
    await engineB.pull(0);

    const tagsOnB = await B.tags.listForEntity("person", ada.id);
    expect(tagsOnB.map((t) => t.name)).toEqual(["Friend"]);
  });

  it("propagates a relationship and its later tombstone", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);

    const parent = await A.people.create({ firstName: "Ada", lastName: "L" });
    const child = await A.people.create({ firstName: "Byron", lastName: "L" });
    const rel = await A.relationships.create({
      aType: "person",
      aId: parent.id,
      aRole: "parent",
      bType: "person",
      bId: child.id,
      bRole: "child",
    });
    // Controlled clocks so the delete strictly out-ranks the create (a same-ms
    // create/delete would fall to the canonical tiebreak, not the tombstone).
    await stamp(A, "relationships", rel.id, 1000, { createdAt: 1000 });
    await engineA.push(0);
    await engineB.pull(0);
    const seeded = await A.relationships.get(rel.id);
    expect(await B.relationships.get(rel.id)).toEqual(seeded);

    await A.relationships.softDelete(rel.id);
    await stamp(A, "relationships", rel.id, 2000, {
      createdAt: 1000,
      deletedAt: 2000,
    });
    await engineA.push(1000);
    await engineB.pull(0);
    expect(await B.relationships.get(rel.id)).toBeUndefined();
  });

  it("propagates a relationship dismissal", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);

    const p1 = crypto.randomUUID();
    const p2 = crypto.randomUUID();
    const dismissal = await A.dismissals.create(
      { type: "person", id: p1 },
      { type: "person", id: p2 },
      null,
    );
    await engineA.push(0);
    await engineB.pull(0);

    const onB = await B.dismissals.listForEntity("person", p1);
    expect(onB).toEqual([dismissal]);
  });

  it("propagates a contact method (email)", async () => {
    const engineA = engineFor(A);
    const engineB = engineFor(B);

    const ada = await A.people.create({ firstName: "Ada", lastName: "L" });
    const email = await A.contactMethods.emails.create({
      ownerType: "person",
      ownerId: ada.id,
      label: "home",
      address: "ada@example.com",
    });
    await engineA.push(0);
    await engineB.pull(0);

    expect(await B.contactMethods.emails.get(email.id)).toEqual(email);
  });
});
