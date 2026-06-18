import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDriver } from "../src/driver.js";
import { runMigrations } from "../src/migrations.js";
import { type PeopleRepo, createPeopleRepo } from "../src/people-repo.js";
import { createSyncEngine } from "../src/sync-engine.js";
import { createInMemoryTransport } from "../src/sync-transport.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

/**
 * End-to-end sync of the `people` table over the blind in-memory transport
 * (plans/encryption/sync.md). Two devices share one transport and a fixed
 * master key; the engine seals whole rows under the MK, the relay only ever
 * carries ciphertext + metadata, and `resolveMerge` (whole-row LWW) reconciles
 * on apply. Proves: create propagation, LWW convergence (order-independent),
 * tombstone propagation + resurrection, idempotent re-pull, and the documented
 * lost-update window.
 */

// A fixed 32-byte master key shared by both devices (one account, two devices).
const MK = new Uint8Array(32).fill(7);

/** A device: its own SQLite DB + people repo. */
interface Device {
  db: DatabaseSync;
  driver: SqliteDriver;
  people: PeopleRepo;
}

async function makeDevice(): Promise<Device> {
  const db = new DatabaseSync(":memory:");
  const driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  return { db, driver, people: createPeopleRepo(driver) };
}

/**
 * Force a row's clock to a controlled value so LWW outcomes are deterministic
 * (repo writes stamp `Date.now()`, which we can't order precisely in a test).
 */
async function stamp(
  device: Device,
  id: string,
  updatedAt: number,
  opts: { createdAt?: number; deletedAt?: number | null } = {},
): Promise<void> {
  const row = await device.people.getIncludingDeleted(id);
  await device.driver.run(
    "UPDATE people SET created_at = ?, updated_at = ?, deleted_at = ? WHERE id = ?",
    [
      opts.createdAt ?? row?.createdAt ?? updatedAt,
      updatedAt,
      opts.deletedAt ?? row?.deletedAt ?? null,
      id,
    ],
  );
}

describe("sync engine (people, in-memory transport)", () => {
  let transport: ReturnType<typeof createInMemoryTransport>;
  let A: Device;
  let B: Device;

  beforeEach(async () => {
    transport = createInMemoryTransport();
    A = await makeDevice();
    B = await makeDevice();
  });

  afterEach(() => {
    A.db.close();
    B.db.close();
  });

  it("propagates a created row from one device to the other", async () => {
    const engineA = createSyncEngine({
      transport,
      masterKey: MK,
      people: A.people,
    });
    const engineB = createSyncEngine({
      transport,
      masterKey: MK,
      people: B.people,
    });

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

  it("never exposes domain fields to the transport (only ciphertext + metadata)", async () => {
    const engineA = createSyncEngine({
      transport,
      masterKey: MK,
      people: A.people,
    });
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
    // Seed the same row on both devices via sync.
    const engineA = createSyncEngine({
      transport,
      masterKey: MK,
      people: A.people,
    });
    const engineB = createSyncEngine({
      transport,
      masterKey: MK,
      people: B.people,
    });
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await stamp(A, ada.id, 1000, { createdAt: 1000 });
    await engineA.push(0);
    let cursorB = await engineB.pull(0);

    // Concurrent edits: A is newer (3000), B is older (2000).
    await A.people.update(ada.id, { gender: "female" });
    await stamp(A, ada.id, 3000, { createdAt: 1000 });
    await B.people.update(ada.id, { lastName: "Byron" });
    await stamp(B, ada.id, 2000, { createdAt: 1000 });

    await engineA.push(1000); // push A's 3000 edit
    await engineB.push(1000); // push B's 2000 edit

    // Each device pulls the other's edit; arrival order differs per device.
    await engineA.pull(0);
    cursorB = await engineB.pull(cursorB);

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
    const engineA = createSyncEngine({
      transport,
      masterKey: MK,
      people: A.people,
    });
    const engineB = createSyncEngine({
      transport,
      masterKey: MK,
      people: B.people,
    });
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await stamp(A, ada.id, 1000, { createdAt: 1000 });
    await engineA.push(0);
    await engineB.pull(0);

    // A deletes at 2000; tombstone propagates to B.
    await A.people.softDelete(ada.id);
    await stamp(A, ada.id, 2000, { createdAt: 1000, deletedAt: 2000 });
    await engineA.push(1000);
    await engineB.pull(0);

    expect(await B.people.get(ada.id)).toBeUndefined(); // hidden from live reads
    const tombstone = await B.people.getIncludingDeleted(ada.id);
    expect(tombstone?.deletedAt).toBe(2000);

    // B edits at 3000 — a later write resurrects per LWW. (Written directly
    // because the repo's `update` skips soft-deleted rows.)
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
    const engineA = createSyncEngine({
      transport,
      masterKey: MK,
      people: A.people,
    });
    const engineB = createSyncEngine({
      transport,
      masterKey: MK,
      people: B.people,
    });
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await engineA.push(0);

    const cursor1 = await engineB.pull(0);
    const before = await B.people.get(ada.id);
    const cursor2 = await engineB.pull(cursor1);
    const after = await B.people.get(ada.id);

    expect(cursor2).toBe(cursor1); // nothing new delivered
    expect(after).toEqual(before);
    // Re-pulling from the start re-applies the same record with no change.
    await engineB.pull(0);
    expect(await B.people.get(ada.id)).toEqual(before);
  });

  it("loses the lower-updatedAt field edit (the accepted lost-update window)", async () => {
    const engineA = createSyncEngine({
      transport,
      masterKey: MK,
      people: A.people,
    });
    const engineB = createSyncEngine({
      transport,
      masterKey: MK,
      people: B.people,
    });
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await stamp(A, ada.id, 1000, { createdAt: 1000 });
    await engineA.push(0);
    const cursorB = await engineB.pull(0);

    // Two devices edit *different* fields in one sync gap.
    await A.people.update(ada.id, { gender: "female" }); // A: gender, ts 3000
    await stamp(A, ada.id, 3000, { createdAt: 1000 });
    await B.people.update(ada.id, { middleName: "Augusta" }); // B: middleName, ts 2000
    await stamp(B, ada.id, 2000, { createdAt: 1000 });

    await engineA.push(1000);
    await engineB.push(1000);
    await engineA.pull(0);
    await engineB.pull(cursorB);

    // Whole-row LWW keeps A's row; B's middleName edit is lost.
    const onA = await A.people.getIncludingDeleted(ada.id);
    const onB = await B.people.getIncludingDeleted(ada.id);
    expect(onA).toEqual(onB); // still converged
    expect(onA?.gender).toBe("female");
    expect(onA?.middleName).toBeNull(); // the documented loss
  });
});
