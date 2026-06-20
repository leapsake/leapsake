import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { generateKey, generateSalt } from "@leapsake/crypto";
import {
  type MilestonesRepo,
  type PeopleRepo,
  type SqliteDriver,
  type SyncableRepo,
  createContentCipher,
  createHttpSyncTransport,
  createMilestonesRepo,
  createPeopleRepo,
  createSyncEngine,
  createSyncStateRepo,
  runMigrations,
} from "@leapsake/data";
import type { SyncRow } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRelayServer } from "../src/relay.js";
import { createRelayStore } from "../src/store.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

/**
 * End-to-end sync over the **real** blind HTTPS relay (plans/encryption/sync.md
 * §2). Two devices, one account, talk through `createHttpSyncTransport` to a live
 * `createRelayServer` on an ephemeral port. Mirrors the in-memory transport's
 * `packages/data/test/sync.test.ts` — but over the wire, and adds the two
 * properties only the real relay can prove: blindness of what it stores, and that
 * it authenticates (a bad/absent bearer is rejected).
 */

// One account shared by both devices; its credentials are independent of the
// sync master key (the verifier authenticates to the relay, MK seals content).
const ACCOUNT_ID = crypto.randomUUID();
const AUTH_VERIFIER = generateKey();
const KDF_SALT = generateSalt();
const MK = new Uint8Array(32).fill(7);

interface Device {
  db: DatabaseSync;
  driver: SqliteDriver;
  people: PeopleRepo;
  milestones: MilestonesRepo;
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
    milestones: createMilestonesRepo(driver, cipher),
  };
}

function syncables(d: Device): SyncableRepo<SyncRow>[] {
  return [d.people, d.milestones];
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

describe("blind HTTPS relay (server + adapter)", () => {
  let server: Server;
  let relayDb: DatabaseSync;
  let baseUrl: string;
  let A: Device;
  let B: Device;

  function transportFor(authVerifier: Uint8Array = AUTH_VERIFIER) {
    return createHttpSyncTransport({
      baseUrl,
      accountId: ACCOUNT_ID,
      authVerifier,
    });
  }

  function engineFor(d: Device, authVerifier?: Uint8Array) {
    return createSyncEngine({
      transport: transportFor(authVerifier),
      masterKey: MK,
      repos: syncables(d),
      syncState: createSyncStateRepo(d.driver),
    });
  }

  beforeEach(async () => {
    relayDb = new DatabaseSync(":memory:");
    server = createRelayServer({ store: createRelayStore(relayDb) });
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
    await transportFor().register(KDF_SALT);
    A = await makeDevice();
    B = await makeDevice();
  });

  afterEach(async () => {
    A.db.close();
    B.db.close();
    relayDb.close();
    await close(server);
  });

  it("converges a created person over the wire (A pushes, B pulls)", async () => {
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await engineFor(A).sync(); // push
    await engineFor(B).sync(); // pull

    expect(await B.people.get(ada.id)).toEqual(ada); // identical, over the wire
  });

  it("round-trips an encrypted milestone note; content keys never leave the device", async () => {
    const milestone = await A.milestones.create({
      kind: "birthday",
      subjectType: "person",
      subjectId: crypto.randomUUID(),
      month: 6,
      day: 18,
      note: "secret picnic",
    });
    await engineFor(A).sync();
    await engineFor(B).sync();

    const onB = await B.milestones.get(milestone.id);
    expect(onB).toEqual(milestone);
    expect(onB?.note).toBe("secret picnic");

    // B decrypts under its *own* content key, minted on apply — it holds exactly
    // one content wrap, and no key_wrap row ever crossed the wire.
    const bWraps = await B.driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE wrapped_kind = 'content' AND deleted_at IS NULL",
    );
    expect(bWraps[0].n).toBe(1);
  });

  it("stores only ciphertext + sync metadata (the relay is blind)", async () => {
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await engineFor(A).sync();

    const rows = relayDb
      .prepare(
        "SELECT id, table_name, updated_at, deleted_at, ciphertext FROM relay_record",
      )
      .all() as {
      id: string;
      table_name: string;
      updated_at: number;
      deleted_at: number | null;
      ciphertext: Uint8Array;
    }[];

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.id).toBe(ada.id);
    expect(row.table_name).toBe("people");
    expect(row.updated_at).toBe(ada.updatedAt);
    // The name appears nowhere the relay can read — not the cleartext metadata,
    // and not (decoded as text) the sealed ciphertext.
    const metadata = JSON.stringify({
      id: row.id,
      table: row.table_name,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    });
    expect(metadata).not.toContain("Lovelace");
    expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain(
      "Lovelace",
    );
  });

  it("rejects sync without a valid bearer (401)", async () => {
    // No Authorization header at all.
    const anon = await fetch(`${baseUrl}/sync/pull?since=0`);
    expect(anon.status).toBe(401);

    // Right account, wrong verifier.
    const forged = transportFor(generateKey());
    await expect(forged.pull(0)).rejects.toThrow(/401/);
    await expect(forged.push([])).rejects.toThrow(/401/);
  });

  it("persists the pull cursor so a fresh engine resumes, not from zero", async () => {
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await engineFor(A).sync();
    await engineFor(B).sync();
    expect(await B.people.get(ada.id)).toEqual(ada);

    const cursor = await createSyncStateRepo(B.driver).getPullCursor();
    expect(cursor).toBeGreaterThan(0); // durably recorded

    // A new row, and a *fresh* engine on B (new state repo from the same DB).
    const grace = await A.people.create({
      firstName: "Grace",
      lastName: "Hopper",
    });
    await engineFor(A).sync();
    await engineFor(B).sync();

    expect(await B.people.get(grace.id)).toEqual(grace);
    expect(await createSyncStateRepo(B.driver).getPullCursor()).toBeGreaterThan(
      cursor,
    );
  });
});
