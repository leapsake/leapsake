import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import {
  createInMemoryKeyStore,
  generateKey,
  generateSalt,
} from "@leapsake/crypto";
import { enableSync, ensureDeviceMasterKey, joinAccount } from "@leapsake/core";
import {
  type MilestonesRepo,
  type PeopleRepo,
  type SqliteDriver,
  type SyncableRepo,
  createAccountRepo,
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
const USERNAME = "ada";
// Opaque wrap(MK, KEK) ciphertext from the relay's point of view; the pre-join
// sync cases never unwrap it, so any bytes do.
const WRAPPED_MK = new Uint8Array(48).fill(9);

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

/** A fresh, migrated device with its own keystore — MK not yet established. */
function blankDevice() {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    driver: nodeSqliteDriver(db),
    keyStore: createInMemoryKeyStore(),
  };
}

/** The domain repos for a device once its master key is known. */
function reposFor(driver: SqliteDriver, masterKey: Uint8Array) {
  const cipher = createContentCipher({ driver, masterKey });
  return {
    people: createPeopleRepo(driver),
    milestones: createMilestonesRepo(driver, cipher),
  };
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
    await transportFor().register({
      username: USERNAME,
      kdfSalt: KDF_SALT,
      wrappedMasterKey: WRAPPED_MK,
    });
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

  it("rejects a duplicate username with 409", async () => {
    // A *different* account claiming the already-registered username conflicts.
    const res = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: crypto.randomUUID(),
        username: USERNAME,
        authVerifier: Buffer.from(generateKey()).toString("base64"),
        kdfSalt: Buffer.from(generateSalt()).toString("base64"),
        wrappedMasterKey: Buffer.from(WRAPPED_MK).toString("base64"),
      }),
    });
    expect(res.status).toBe(409);
  });

  it("resolves a username to its account id + salt (prelogin), 404 otherwise", async () => {
    const found = await transportFor().lookup(USERNAME);
    expect(found.accountId).toBe(ACCOUNT_ID);
    expect(found.kdfSalt).toEqual(KDF_SALT);

    const missing = await fetch(`${baseUrl}/accounts/lookup?username=nobody`);
    expect(missing.status).toBe(404);
  });

  it("serves the wrapped master key only to an authenticated device", async () => {
    // Authenticated → the opaque wrap(MK, KEK) the relay can't read.
    const wrapped = await transportFor().fetchBootstrap({
      accountId: ACCOUNT_ID,
      authVerifier: AUTH_VERIFIER,
    });
    expect(wrapped).toEqual(WRAPPED_MK);

    // Unauthenticated bootstrap → 401.
    const anon = await fetch(`${baseUrl}/accounts/bootstrap`);
    expect(anon.status).toBe(401);
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

/**
 * The Stage-1 completion: multi-device account login over the real relay
 * (plans/encryption/multi-device-login.md). Unlike the block above — where both
 * devices were handed a shared master key — here device 2 starts knowing *only*
 * the relay URL, username, and password, and obtains the master key through the
 * relay's blind account-bootstrap channel, then converges.
 */
describe("multi-device login over the relay (enable → join → converge)", () => {
  const PASSWORD = "correct horse battery staple";
  let server: Server;
  let relayDb: DatabaseSync;
  let baseUrl: string;

  beforeEach(async () => {
    relayDb = new DatabaseSync(":memory:");
    server = createRelayServer({ store: createRelayStore(relayDb) });
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
  });

  afterEach(async () => {
    relayDb.close();
    await close(server);
  });

  async function enableAndRegister(device: ReturnType<typeof blankDevice>) {
    await runMigrations(device.driver);
    const mk = await ensureDeviceMasterKey({
      keyStore: device.keyStore,
      driver: device.driver,
    });
    const { bootstrap } = await enableSync({
      keyStore: device.keyStore,
      driver: device.driver,
      username: "Ada", // mixed case → normalized to "ada"
      password: PASSWORD,
      relayUrl: baseUrl,
      platform: "desktop",
    });
    await createHttpSyncTransport({
      baseUrl,
      accountId: bootstrap.accountId,
      authVerifier: bootstrap.authVerifier,
    }).register({
      username: bootstrap.username ?? "",
      kdfSalt: bootstrap.kdfSalt,
      wrappedMasterKey: bootstrap.wrappedMasterKey,
    });
    return { masterKey: mk.masterKey };
  }

  it("a fresh device logs in by username+password and reads the first device's encrypted data", async () => {
    // --- Device 1: enable, register, create a person + sealed note, push. ---
    const d1 = blankDevice();
    const { masterKey: mk1 } = await enableAndRegister(d1);
    const d1Repos = reposFor(d1.driver, mk1);
    const ada = await d1Repos.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const milestone = await d1Repos.milestones.create({
      kind: "birthday",
      subjectType: "person",
      subjectId: ada.id,
      month: 6,
      day: 18,
      note: "secret picnic",
    });
    const d1Account = await createAccountRepo(d1.driver).getSingleton();
    await createSyncEngine({
      transport: createHttpSyncTransport({
        baseUrl,
        accountId: d1Account!.id,
        authVerifier: d1Account!.authVerifier,
      }),
      masterKey: mk1,
      repos: [d1Repos.people, d1Repos.milestones],
      syncState: createSyncStateRepo(d1.driver),
    }).sync();

    // --- Device 2: fresh, knows only relay URL + username + password. ---
    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    const session = await joinAccount({
      keyStore: d2.keyStore,
      driver: d2.driver,
      transport: createHttpSyncTransport({ baseUrl }), // credential-less bootstrap
      relayUrl: baseUrl,
      username: "ada",
      password: PASSWORD,
      platform: "mobile",
    });
    // It recovered the *account* master key over the blind relay.
    expect(session.masterKey).toEqual(mk1);

    // --- Device 2 syncs and reads device 1's data, decrypted. ---
    const d2Account = await createAccountRepo(d2.driver).getSingleton();
    const d2Repos = reposFor(d2.driver, session.masterKey);
    await createSyncEngine({
      transport: createHttpSyncTransport({
        baseUrl,
        accountId: d2Account!.id,
        authVerifier: d2Account!.authVerifier,
      }),
      masterKey: session.masterKey,
      repos: [d2Repos.people, d2Repos.milestones],
      syncState: createSyncStateRepo(d2.driver),
    }).sync();

    expect(await d2Repos.people.get(ada.id)).toEqual(ada);
    expect((await d2Repos.milestones.get(milestone.id))?.note).toBe(
      "secret picnic",
    );

    // The account-identity / key tables never replicate: the relay log carries
    // only domain tables, never account/device/key_wrap/content_key.
    const names = (
      relayDb.prepare("SELECT DISTINCT table_name FROM relay_record").all() as {
        table_name: string;
      }[]
    ).map((t) => t.table_name);
    expect(names).not.toContain("account");
    expect(names).not.toContain("key_wrap");
    expect(names).not.toContain("content_key");

    d1.db.close();
    d2.db.close();
  });

  it("rejects a join with the wrong password (relay 401, before any unwrap)", async () => {
    const d1 = blankDevice();
    await enableAndRegister(d1);

    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    await expect(
      joinAccount({
        keyStore: d2.keyStore,
        driver: d2.driver,
        transport: createHttpSyncTransport({ baseUrl }),
        relayUrl: baseUrl,
        username: "ada",
        password: "wrong password",
      }),
    ).rejects.toThrow(/401/);
    // No account row was written on the failed join.
    expect(await createAccountRepo(d2.driver).getSingleton()).toBeUndefined();

    d1.db.close();
    d2.db.close();
  });
});
