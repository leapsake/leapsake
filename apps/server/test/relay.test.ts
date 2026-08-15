import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import {
  DATABASE_KEY,
  RECOVERY_KEY,
  createInMemoryKeyStore,
  deriveRecoveryVerifier,
  encodeRecoveryPhrase,
  generateKey,
  generateSalt,
} from "@leapsake/crypto";
import { bytesToBase64 } from "@leapsake/bytes";
import {
  bindRelayToAccount,
  convergeRecoveryKey,
  createCore,
  enableSync,
  ensureDeviceMasterKey,
  getSyncStatus,
  isUsernameTakenError,
  joinAccount,
  joinAccountViaRelay,
  reauthenticateViaRelay,
  recoverAccountViaRelay,
  reconcileOnJoin,
  registerAccountWithRelay,
  rotateRecoveryPhraseForAccount,
  runAccountSync,
  unlockWithPassword,
  unlockWithRecoveryKey,
} from "@leapsake/core";
import {
  type MilestonesRepo,
  type PeopleRepo,
  type SqliteDriver,
  type SyncableRepo,
  createAccountRepo,
  createMilestonesRepo,
  createPeopleRepo,
  createSyncStateRepo,
  runMigrations,
} from "@leapsake/data";
import { createHttpSyncTransport, createSyncEngine } from "@leapsake/sync";
import type { SyncRow } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRelayServer } from "../src/relay.js";
import { createRelayStore } from "../src/store.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

/**
 * These tests exercise the **relay protocol**, not at-rest storage: their drivers
 * are plain in-memory SQLite with no encrypted store and no db-key, so there is no
 * password door to persist. The port is required at the type level precisely so a
 * real client cannot forget it; here it is deliberately a sink.
 */
const discardSidecar = () => Promise.resolve();

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
// Recovery escrow (model.md §6): opaque wrap(MK, recoveryKey) + a recovery
// verifier. Like WRAPPED_MK, the pre-join sync cases never unwrap them.
const WRAPPED_MK_RECOVERY = new Uint8Array(48).fill(5);
// Inverse escrow wrap(recoveryKey, MK) — the one-phrase unification escrow. Opaque
// here too; pre-join sync cases never unwrap it.
const WRAPPED_RECOVERY_KEY = new Uint8Array(48).fill(3);
const RECOVERY_VERIFIER = generateKey();

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
  return {
    db,
    driver,
    people: createPeopleRepo(driver),
    milestones: createMilestonesRepo(driver),
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
function reposFor(driver: SqliteDriver) {
  return {
    people: createPeopleRepo(driver),
    milestones: createMilestonesRepo(driver),
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

  /**
   * Log in with a verifier and return the raw session token, for the tests that
   * hit the session-authed hot path (`/sync/push|pull`) with a raw `fetch` rather
   * than the transport (which manages sessions itself).
   */
  async function mintSession(
    verifier: Uint8Array = AUTH_VERIFIER,
  ): Promise<string> {
    const bearer = `Bearer ${ACCOUNT_ID}.${Buffer.from(verifier).toString("base64")}`;
    const res = await fetch(`${baseUrl}/accounts/session`, {
      method: "POST",
      headers: { authorization: bearer },
    });
    if (!res.ok) throw new Error(`mintSession failed: ${res.status}`);
    return ((await res.json()) as { token: string }).token;
  }

  beforeEach(async () => {
    relayDb = new DatabaseSync(":memory:");
    server = createRelayServer({ store: createRelayStore(relayDb) });
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
    await transportFor().register({
      username: USERNAME,
      kdfSalt: KDF_SALT,
      wrappedMasterKey: WRAPPED_MK,
      wrappedRecoveryKey: WRAPPED_RECOVERY_KEY,
      wrappedMasterKeyRecovery: WRAPPED_MK_RECOVERY,
      recoveryVerifier: RECOVERY_VERIFIER,
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

  it("skips an undecryptable record and still converges the batch (M3)", async () => {
    // A valid record on the log…
    const ada = await A.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await engineFor(A).sync();

    // …then inject a garbage-ciphertext record for a *real* table straight onto the
    // relay (bypassing the client seal), as a hostile/buggy relay or a corrupt row
    // would. Long enough to clear the open() length guard, so it exercises the
    // sync-engine per-record try/catch, not just the crypto guard. The hot push
    // path is session-authed (H3), so log in with the verifier first.
    const session = `Session ${await mintSession(AUTH_VERIFIER)}`;
    const inject = await fetch(`${baseUrl}/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: session },
      body: JSON.stringify({
        records: [
          {
            id: crypto.randomUUID(),
            table: "people",
            updatedAt: ada.updatedAt + 1,
            deletedAt: null,
            ciphertext: Buffer.from(new Uint8Array(48).fill(3)).toString(
              "base64",
            ),
          },
        ],
      }),
    });
    expect(inject.status).toBe(200);

    // B pulls the whole batch (valid + poison) from the start: it must not throw,
    // the valid row converges, and the poison is skipped — so only the valid record
    // counts toward `applied`.
    const engineB = engineFor(B);
    const first = await engineB.pull(0);
    expect(first.applied).toBe(1);
    expect(await B.people.get(ada.id)).toEqual(ada);

    // The returned cursor advanced past the poison, so a second pull from it is
    // clean (nothing re-pulled, no re-throw) — the permanent-poisoning loop the
    // finding describes is broken.
    const second = await engineB.pull(first.cursor);
    expect(second.applied).toBe(0);
  });

  // `milestone.note` stopped being a per-item-content-key consumer on 2026-07-27
  // (migration 27). The relay-facing guarantee is unchanged and still worth
  // pinning: the note round-trips through a blind relay, and no key row follows.
  it("round-trips a milestone note through the relay; no key row follows", async () => {
    const milestone = await A.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: crypto.randomUUID(),
      month: 6,
      day: 18,
      note: "secret picnic",
    });
    await engineFor(A).sync();
    await engineFor(B).sync();

    const onB = await B.milestones.get(milestone.id);
    expect(onB).toEqual(milestone);
    expect(onB?.note).toBe("secret picnic");

    // No content wrap exists on either side any more, and none ever crossed the
    // wire — the regression guard that layer 3 has not crept back into a field.
    for (const device of [A, B]) {
      const wraps = await device.driver.all<{ n: number }>(
        "SELECT COUNT(*) AS n FROM key_wrap WHERE wrapped_kind = 'content' AND deleted_at IS NULL",
      );
      expect(wraps[0].n).toBe(0);
    }
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

    // Right account, wrong verifier: the transport's login fails → a 401 throw.
    const forged = transportFor(generateKey());
    await expect(forged.pull(0)).rejects.toThrow(/401/);
    await expect(forged.push([])).rejects.toThrow(/401/);
  });

  it("mints a session from the verifier and authorizes the hot path with it (H3)", async () => {
    const token = await mintSession();
    const pulled = await fetch(`${baseUrl}/sync/pull?since=0`, {
      headers: { authorization: `Session ${token}` },
    });
    expect(pulled.status).toBe(200);

    // A wrong verifier can't mint a session in the first place.
    await expect(mintSession(generateKey())).rejects.toThrow(/401/);
  });

  it("no longer accepts the raw verifier on the hot path — session required (H3)", async () => {
    // The pre-H3 credential (`Bearer <accountId>.<verifier>`) is now rejected on
    // push/pull; the verifier only mints sessions, it doesn't authorize sync.
    const bearer = `Bearer ${ACCOUNT_ID}.${Buffer.from(AUTH_VERIFIER).toString("base64")}`;
    const pulled = await fetch(`${baseUrl}/sync/pull?since=0`, {
      headers: { authorization: bearer },
    });
    expect(pulled.status).toBe(401);
  });

  it("rejects an expired session token (H3)", async () => {
    // A dedicated relay with an already-elapsed TTL: the token is dead on arrival.
    const shortLived = createRelayServer({
      store: createRelayStore(relayDb),
      sessionTtlMs: 0,
    });
    const shortUrl = `http://127.0.0.1:${await listen(shortLived)}`;
    try {
      const login = await fetch(`${shortUrl}/accounts/session`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${ACCOUNT_ID}.${Buffer.from(AUTH_VERIFIER).toString("base64")}`,
        },
      });
      const { token } = (await login.json()) as { token: string };
      const pulled = await fetch(`${shortUrl}/sync/pull?since=0`, {
        headers: { authorization: `Session ${token}` },
      });
      expect(pulled.status).toBe(401);
    } finally {
      await close(shortLived);
    }
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
    // Authenticated → the opaque wrap(MK, KEK) the relay can't read, plus the
    // inverse escrow wrap(recoveryKey, MK) a joining device adopts.
    const wrapped = await transportFor().fetchBootstrap({
      accountId: ACCOUNT_ID,
      authVerifier: AUTH_VERIFIER,
    });
    expect(wrapped.wrappedMasterKey).toEqual(WRAPPED_MK);
    expect(wrapped.wrappedRecoveryKey).toEqual(WRAPPED_RECOVERY_KEY);

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
 * (plans/encryption/sync.md). Unlike the block above — where both
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
      wrappedRecoveryKey: bootstrap.wrappedRecoveryKey,
      wrappedMasterKeyRecovery: bootstrap.wrappedMasterKeyRecovery,
      recoveryVerifier: bootstrap.recoveryVerifier,
    });
    return { masterKey: mk.masterKey };
  }

  it("a fresh device logs in by username+password and reads the first device's encrypted data", async () => {
    // --- Device 1: enable, register, create a person + sealed note, push. ---
    const d1 = blankDevice();
    const { masterKey: mk1 } = await enableAndRegister(d1);
    const d1Repos = reposFor(d1.driver);
    const ada = await d1Repos.people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const milestone = await d1Repos.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: ada.id,
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
    const d2Repos = reposFor(d2.driver);
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

    // A joined device must keep a **local** password door on MK, not just the
    // relay's copy. Without it a keychain loss is unrecoverable here: the password
    // sidecar reopens the store file, but nothing on the device leads from that
    // password back to the master key, so the boot-path repair (slice 9) has
    // nothing to read and the device is stuck. Creation and recovery both wrote
    // this row; join did not, and it was found only by driving a joined device
    // through a wiped keychain.
    expect(
      (await unlockWithPassword({ driver: d2.driver, password: PASSWORD }))
        .masterKey,
    ).toEqual(mk1);

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

  it("a fresh device recovers the account from the recovery phrase, resets the password, and reads the data", async () => {
    // --- Device 1: enable (capture the recovery phrase), register, push. ---
    const d1 = blankDevice();
    await runMigrations(d1.driver);
    const mk = await ensureDeviceMasterKey({
      keyStore: d1.keyStore,
      driver: d1.driver,
    });
    const { recoveryKey, bootstrap } = await enableSync({
      keyStore: d1.keyStore,
      driver: d1.driver,
      username: "ada",
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
      wrappedRecoveryKey: bootstrap.wrappedRecoveryKey,
      wrappedMasterKeyRecovery: bootstrap.wrappedMasterKeyRecovery,
      recoveryVerifier: bootstrap.recoveryVerifier,
    });
    const phrase = encodeRecoveryPhrase(recoveryKey);
    const ada = await reposFor(d1.driver).people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await runAccountSync({
      keyStore: d1.keyStore,
      driver: d1.driver,
      masterKey: mk.masterKey,
    });

    // --- Device 2: fresh, forgot the password — has only the recovery phrase. ---
    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    const NEW_PASSWORD = "a brand new battery horse staple";
    const session = await recoverAccountViaRelay({
      writePasswordSidecar: discardSidecar,
      keyStore: d2.keyStore,
      driver: d2.driver,
      relayUrl: baseUrl,
      username: "ada",
      recoveryPhrase: phrase,
      newPassword: NEW_PASSWORD,
      platform: "mobile",
    });
    // It recovered the *account* master key from the relay's recovery escrow.
    expect(session.masterKey).toEqual(mk.masterKey);

    // Device 2 syncs and reads device 1's data, decrypted.
    await runAccountSync({
      keyStore: d2.keyStore,
      driver: d2.driver,
      masterKey: session.masterKey,
    });
    expect(await reposFor(d2.driver).people.get(ada.id)).toEqual(ada);

    // The newly-set password now unlocks MK locally (the reset took on the relay
    // and the local password door was laid down).
    const unlocked = await unlockWithPassword({
      driver: d2.driver,
      password: NEW_PASSWORD,
    });
    expect(unlocked.masterKey).toEqual(mk.masterKey);

    d1.db.close();
    d2.db.close();
  });

  it("rejects recovery with a wrong recovery phrase", async () => {
    const d1 = blankDevice();
    const { masterKey: _mk } = await enableAndRegister(d1);

    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    // A valid-format phrase for the *wrong* key → wrong verifier → relay 401.
    const wrongPhrase = encodeRecoveryPhrase(new Uint8Array(32).fill(1));
    await expect(
      recoverAccountViaRelay({
        writePasswordSidecar: discardSidecar,
        keyStore: d2.keyStore,
        driver: d2.driver,
        relayUrl: baseUrl,
        username: "ada",
        recoveryPhrase: wrongPhrase,
        newPassword: "a brand new battery horse staple",
      }),
    ).rejects.toThrow();

    d1.db.close();
    d2.db.close();
  });

  it("re-authenticates a device after the password is reset on another device", async () => {
    // --- Device 1: enable (capture the phrase) + register, create Ada, push. ---
    const d1 = blankDevice();
    await runMigrations(d1.driver);
    const mk = await ensureDeviceMasterKey({
      keyStore: d1.keyStore,
      driver: d1.driver,
    });
    const { recoveryKey, bootstrap } = await enableSync({
      keyStore: d1.keyStore,
      driver: d1.driver,
      username: "ada",
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
      wrappedRecoveryKey: bootstrap.wrappedRecoveryKey,
      wrappedMasterKeyRecovery: bootstrap.wrappedMasterKeyRecovery,
      recoveryVerifier: bootstrap.recoveryVerifier,
    });
    const phrase = encodeRecoveryPhrase(recoveryKey);
    const ada = await reposFor(d1.driver).people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await runAccountSync({
      keyStore: d1.keyStore,
      driver: d1.driver,
      masterKey: mk.masterKey,
    });

    // --- Device 2: join by username+password, sync, read Ada. It now holds the
    //     original-password credential. ---
    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    const d2session = await joinAccount({
      keyStore: d2.keyStore,
      driver: d2.driver,
      transport: createHttpSyncTransport({ baseUrl }),
      relayUrl: baseUrl,
      username: "ada",
      password: PASSWORD,
      platform: "mobile",
    });
    await runAccountSync({
      keyStore: d2.keyStore,
      driver: d2.driver,
      masterKey: d2session.masterKey,
    });
    expect(await reposFor(d2.driver).people.get(ada.id)).toEqual(ada);

    // --- Device 3: recover from the phrase, which resets the account password —
    //     the event that strands device 2's credential. ---
    const d3 = blankDevice();
    await runMigrations(d3.driver);
    await ensureDeviceMasterKey({ keyStore: d3.keyStore, driver: d3.driver });
    const NEW_PASSWORD = "a brand new battery horse staple";
    const d3session = await recoverAccountViaRelay({
      writePasswordSidecar: discardSidecar,
      keyStore: d3.keyStore,
      driver: d3.driver,
      relayUrl: baseUrl,
      username: "ada",
      recoveryPhrase: phrase,
      newPassword: NEW_PASSWORD,
      platform: "desktop",
    });

    // Device 2's credential is now stale → its sync fails with a relay 401.
    await expect(
      runAccountSync({
        keyStore: d2.keyStore,
        driver: d2.driver,
        masterKey: d2session.masterKey,
      }),
    ).rejects.toThrow(/401/);

    // A wrong password fails at the relay's verifier check, before any local
    // mutation (the account row keeps its stale — and still-wrong — credential).
    await expect(
      reauthenticateViaRelay({
        writePasswordSidecar: discardSidecar,
        keyStore: d2.keyStore,
        driver: d2.driver,
        password: "not the new password",
      }),
    ).rejects.toThrow();
    await expect(
      runAccountSync({
        keyStore: d2.keyStore,
        driver: d2.driver,
        masterKey: d2session.masterKey,
      }),
    ).rejects.toThrow(/401/);

    // Device 2 re-authenticates with the new password — the MK is untouched — and
    // resumes syncing: it pulls a person device 3 pushes after the reset.
    await reauthenticateViaRelay({
      writePasswordSidecar: discardSidecar,
      keyStore: d2.keyStore,
      driver: d2.driver,
      password: NEW_PASSWORD,
    });
    const grace = await reposFor(d3.driver).people.create({
      firstName: "Grace",
      lastName: "Hopper",
    });
    await runAccountSync({
      keyStore: d3.keyStore,
      driver: d3.driver,
      masterKey: d3session.masterKey,
    });
    await runAccountSync({
      keyStore: d2.keyStore,
      driver: d2.driver,
      masterKey: d2session.masterKey,
    });
    expect(await reposFor(d2.driver).people.get(grace.id)).toEqual(grace);

    d1.db.close();
    d2.db.close();
    d3.db.close();
  });

  it("reconcile-on-join surfaces local↔account duplicates without auto-merging, and keeps local data", async () => {
    // --- Device 1: enable + register, create "Jane Doe", push. ---
    const d1 = blankDevice();
    const { masterKey: mk1 } = await enableAndRegister(d1);
    const d1People = createPeopleRepo(d1.driver);
    const accountJane = await d1People.create({
      firstName: "Jane",
      lastName: "Doe",
    });
    await runAccountSync({
      keyStore: d1.keyStore,
      driver: d1.driver,
      masterKey: mk1,
    });

    // --- Device 2: fresh, but already holds its own local "Jane Doe" (a
    // distinct-id duplicate of the account's) and an unrelated "Bob Jones"
    // before it ever joins. ---
    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    const d2People = createPeopleRepo(d2.driver);
    const localJane = await d2People.create({
      firstName: "Jane",
      lastName: "Doe",
    });
    const bob = await d2People.create({ firstName: "Bob", lastName: "Jones" });
    expect(localJane.id).not.toBe(accountJane.id);

    // --- Join, then reconcile. ---
    const session = await joinAccount({
      keyStore: d2.keyStore,
      driver: d2.driver,
      transport: createHttpSyncTransport({ baseUrl }),
      relayUrl: baseUrl,
      username: "ada",
      password: PASSWORD,
      platform: "mobile",
    });
    const d2Core = createCore(d2.driver, session);
    const { duplicateCount } = await reconcileOnJoin({
      driver: d2.driver,
      masterKey: session.masterKey,
      core: d2Core,
    });

    // The join surfaced exactly the Jane↔Jane pair; Bob is unique and ignored.
    expect(duplicateCount).toBe(1);

    // No auto-merge: both Janes and Bob are still active on B...
    const activeIds = (await d2People.list()).map((p) => p.id);
    expect(activeIds).toContain(localJane.id);
    expect(activeIds).toContain(accountJane.id);
    expect(activeIds).toContain(bob.id);

    // ...and the pair is offered through the normal duplicate-review surface.
    const candidates = await d2Core.duplicates.findCandidates();
    expect(
      candidates.some((c) => {
        const ids = new Set([c.a.id, c.b.id]);
        return ids.has(localJane.id) && ids.has(accountJane.id);
      }),
    ).toBe(true);

    // Local data is preserved, not abandoned: B's normal sync pushes it up and
    // device 1 converges on Bob + the second Jane.
    await runAccountSync({
      keyStore: d2.keyStore,
      driver: d2.driver,
      masterKey: session.masterKey,
    });
    await runAccountSync({
      keyStore: d1.keyStore,
      driver: d1.driver,
      masterKey: mk1,
    });
    const onD1 = (await d1People.list()).map((p) => p.id);
    expect(onD1).toContain(bob.id);
    expect(onD1).toContain(localJane.id);
    expect(onD1).toContain(accountJane.id);

    d1.db.close();
    d2.db.close();
  });

  /**
   * Custody slice 8 — replacing the recovery phrase. These are the properties the
   * *relay* half must hold: the escrow really moves, the old phrase really stops
   * recovering the account, and a leaked phrase cannot rotate itself.
   *
   * A fake db-key is planted in each keystore because these drivers are plain
   * in-memory SQLite with no encrypted store: rotation seals a door around the
   * db-key, and `captureDoor` is the sink that stands in for a file/row.
   */
  describe("recovery-phrase rotation", () => {
    /** Enable + register, returning the material a rotation test needs. */
    async function enableWithPhrase(device: ReturnType<typeof blankDevice>) {
      await runMigrations(device.driver);
      const mk = await ensureDeviceMasterKey({
        keyStore: device.keyStore,
        driver: device.driver,
      });
      const { recoveryKey, bootstrap } = await enableSync({
        keyStore: device.keyStore,
        driver: device.driver,
        username: "ada",
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
        wrappedRecoveryKey: bootstrap.wrappedRecoveryKey,
        wrappedMasterKeyRecovery: bootstrap.wrappedMasterKeyRecovery,
        recoveryVerifier: bootstrap.recoveryVerifier,
      });
      // Stands in for the encrypted store's key; the door writer is a sink.
      await device.keyStore.setSecret(DATABASE_KEY, generateKey());
      return {
        masterKey: mk.masterKey,
        accountId: bootstrap.accountId,
        authVerifier: bootstrap.authVerifier,
        oldPhrase: encodeRecoveryPhrase(recoveryKey),
      };
    }

    /** A recovery door writer that records what it was handed. */
    function captureDoor() {
      const written: Uint8Array[] = [];
      return {
        written,
        write: (door: Uint8Array) => {
          written.push(door);
          return Promise.resolve();
        },
      };
    }

    it("retires the old phrase for account recovery and puts the new one in its place", async () => {
      const d1 = blankDevice();
      const { masterKey, oldPhrase } = await enableWithPhrase(d1);
      const door = captureDoor();

      const { recoveryPhrase, escrowPending } =
        await rotateRecoveryPhraseForAccount({
          keyStore: d1.keyStore,
          driver: d1.driver,
          password: PASSWORD,
          writeRecoveryDoor: door.write,
        });

      // The relay was reachable, so nothing is deferred, and this device's door
      // was re-sealed around the new key.
      expect(escrowPending).toBe(false);
      expect(recoveryPhrase).not.toBe(oldPhrase);
      expect(door.written).toHaveLength(1);

      // The old phrase no longer authenticates a recovery at all: the relay's
      // verifier hash moved with the escrow (401 before any unwrap).
      const d2 = blankDevice();
      await runMigrations(d2.driver);
      await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
      await expect(
        recoverAccountViaRelay({
          writePasswordSidecar: discardSidecar,
          keyStore: d2.keyStore,
          driver: d2.driver,
          relayUrl: baseUrl,
          username: "ada",
          recoveryPhrase: oldPhrase,
          newPassword: "a brand new battery horse staple",
        }),
      ).rejects.toThrow();

      // The new phrase does, and reaches the same master key — so the escrow was
      // replaced, not merely invalidated.
      const d3 = blankDevice();
      await runMigrations(d3.driver);
      await ensureDeviceMasterKey({ keyStore: d3.keyStore, driver: d3.driver });
      const session = await recoverAccountViaRelay({
        writePasswordSidecar: discardSidecar,
        keyStore: d3.keyStore,
        driver: d3.driver,
        relayUrl: baseUrl,
        username: "ada",
        recoveryPhrase,
        newPassword: "a brand new battery horse staple",
      });
      expect(session.masterKey).toEqual(masterKey);

      d1.db.close();
      d2.db.close();
      d3.db.close();
    });

    it("refuses a rotation authenticated with the recovery credential", async () => {
      // The whole point of the endpoint's password auth: whoever leaked the phrase
      // must not be able to rotate it out from under the owner.
      const d1 = blankDevice();
      const { accountId } = await enableWithPhrase(d1);
      const recoveryKey = await d1.keyStore.getSecret(RECOVERY_KEY);
      const verifier = deriveRecoveryVerifier(
        recoveryKey ?? new Uint8Array(32),
      );

      const res = await fetch(`${baseUrl}/accounts/recovery`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Recovery ${accountId}.${bytesToBase64(verifier)}`,
        },
        body: JSON.stringify({
          wrappedRecoveryKey: bytesToBase64(new Uint8Array(48).fill(1)),
          wrappedMasterKeyRecovery: bytesToBase64(new Uint8Array(48).fill(2)),
          recoveryVerifier: bytesToBase64(new Uint8Array(32).fill(3)),
        }),
      });
      expect(res.status).toBe(401);

      d1.db.close();
    });

    it("rotates offline and flushes the escrow at the next sync", async () => {
      const d1 = blankDevice();
      const { masterKey, oldPhrase, accountId } = await enableWithPhrase(d1);
      const door = captureDoor();

      /** The relay's stored recovery-verifier hash — moves only with the escrow. */
      const escrowVerifier = () =>
        (
          relayDb
            .prepare(
              "SELECT recovery_verifier_hash AS h FROM relay_account WHERE account_id = ?",
            )
            .get(accountId) as { h: Uint8Array }
        ).h.toString();
      const before = escrowVerifier();

      // Offline: every relay call fails the way an unreachable host does.
      const realFetch = globalThis.fetch;
      globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));
      let rotated: { recoveryPhrase: string; escrowPending: boolean };
      try {
        rotated = await rotateRecoveryPhraseForAccount({
          keyStore: d1.keyStore,
          driver: d1.driver,
          password: PASSWORD,
          writeRecoveryDoor: door.write,
        });
      } finally {
        globalThis.fetch = realFetch;
      }

      // The local half landed anyway — that is what makes rotation offline-capable
      // — and the caller is told the relay has not been updated.
      expect(rotated.escrowPending).toBe(true);
      expect(door.written).toHaveLength(1);
      expect(
        await createSyncStateRepo(d1.driver).getRecoveryEscrowPending(),
      ).toBe(true);

      // The relay is untouched, so recovering an account elsewhere still takes the
      // *old* phrase — exactly why the UI must tell the user to keep it. Asserted
      // on the stored escrow rather than by recovering: a real recovery also
      // resets the password door, which would stale this device's credential and
      // make the flush below fail for an unrelated reason.
      expect(escrowVerifier()).toBe(before);

      // The next sync carries it up, and the flag clears.
      await runAccountSync({
        keyStore: d1.keyStore,
        driver: d1.driver,
        masterKey,
      });
      expect(
        await createSyncStateRepo(d1.driver).getRecoveryEscrowPending(),
      ).toBe(false);
      expect(escrowVerifier()).not.toBe(before);

      // Now the old phrase is dead and the new one is the account's.
      const d2 = blankDevice();
      await runMigrations(d2.driver);
      await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
      await expect(
        recoverAccountViaRelay({
          writePasswordSidecar: discardSidecar,
          keyStore: d2.keyStore,
          driver: d2.driver,
          relayUrl: baseUrl,
          username: "ada",
          recoveryPhrase: oldPhrase,
          newPassword: PASSWORD,
        }),
      ).rejects.toThrow();

      const d3 = blankDevice();
      await runMigrations(d3.driver);
      await ensureDeviceMasterKey({ keyStore: d3.keyStore, driver: d3.driver });
      const session = await recoverAccountViaRelay({
        writePasswordSidecar: discardSidecar,
        keyStore: d3.keyStore,
        driver: d3.driver,
        relayUrl: baseUrl,
        username: "ada",
        recoveryPhrase: rotated.recoveryPhrase,
        newPassword: PASSWORD,
      });
      expect(session.masterKey).toEqual(masterKey);

      d1.db.close();
      d2.db.close();
      d3.db.close();
    });

    it("a peer device adopts the rotation at its next launch", async () => {
      const d1 = blankDevice();
      const { masterKey } = await enableWithPhrase(d1);

      // Device 2 joins on the original phrase-era account.
      const d2 = blankDevice();
      await runMigrations(d2.driver);
      await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
      const session = await joinAccountViaRelay({
        writePasswordSidecar: discardSidecar,
        keyStore: d2.keyStore,
        driver: d2.driver,
        relayUrl: baseUrl,
        username: "ada",
        password: PASSWORD,
        platform: "mobile",
      });
      await d2.keyStore.setSecret(DATABASE_KEY, generateKey());

      // Device 1 rotates.
      await rotateRecoveryPhraseForAccount({
        keyStore: d1.keyStore,
        driver: d1.driver,
        password: PASSWORD,
        writeRecoveryDoor: captureDoor().write,
      });
      const rotatedKey = await d1.keyStore.getSecret(RECOVERY_KEY);

      // Device 2 converges on its own, with nothing typed and nothing pushed to
      // it: the relay's inverse escrow plus its own MK are enough.
      const door = captureDoor();
      const outcome = await convergeRecoveryKey({
        keyStore: d2.keyStore,
        driver: d2.driver,
        masterKey: session.masterKey,
        writeRecoveryDoor: door.write,
      });
      expect(outcome).toBe("adopted");
      expect(await d2.keyStore.getSecret(RECOVERY_KEY)).toEqual(rotatedKey);
      expect(door.written).toHaveLength(1);

      // Its *account* door moved too, so the new phrase unwraps MK here.
      const unlocked = await unlockWithRecoveryKey({
        driver: d2.driver,
        recoveryKey: rotatedKey ?? new Uint8Array(32),
      });
      expect(unlocked.masterKey).toEqual(masterKey);

      // Running again is a no-op — it compares before it writes.
      const again = captureDoor();
      expect(
        await convergeRecoveryKey({
          keyStore: d2.keyStore,
          driver: d2.driver,
          masterKey: session.masterKey,
          writeRecoveryDoor: again.write,
        }),
      ).toBe("unchanged");
      expect(again.written).toHaveLength(0);

      d1.db.close();
      d2.db.close();
    });

    it("never pulls a peer's key while its own rotation is still pending", async () => {
      // The self-revert hazard: the rotating device runs the catch-up too, and a
      // pull before its own flush would fetch the relay's *old* escrow and
      // overwrite the key behind a phrase already shown to the user.
      //
      // Staged as the one case the flush cannot clear on its own: pending, but the
      // recovery key is gone (this device signed out between rotating and
      // syncing). The relay is reachable throughout, so a pull would succeed —
      // which is what makes the refusal, not a network error, the thing under test.
      const d1 = blankDevice();
      const { masterKey } = await enableWithPhrase(d1);
      await createSyncStateRepo(d1.driver).setRecoveryEscrowPending(true);
      await d1.keyStore.deleteSecret(RECOVERY_KEY);

      const door = captureDoor();
      expect(
        await convergeRecoveryKey({
          keyStore: d1.keyStore,
          driver: d1.driver,
          masterKey,
          writeRecoveryDoor: door.write,
        }),
      ).toBe("skipped");
      expect(door.written).toHaveLength(0);
      // Still pending: unlocking with the phrase later restores the key, and that
      // sync flushes it. Clearing it here would strand the relay on a phrase
      // nobody holds.
      expect(
        await createSyncStateRepo(d1.driver).getRecoveryEscrowPending(),
      ).toBe(true);

      d1.db.close();
    });
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

/**
 * **Binding a relay to an account that already exists** (`encryption/model.md`
 * §7.2.2), against the real relay rather than a captured bootstrap.
 *
 * `apps/desktop/test/integration/bind-relay.test.ts` already pins what
 * {@link bindRelayToAccount} *publishes*, byte for byte, against a hand-written
 * stub. What a stub cannot answer is whether the relay **accepts** those bytes and
 * whether the account they describe is then usable — which is the whole claim the
 * increment rests on: *a bound-later account is indistinguishable on the relay from
 * one bound at creation.* Every case here ends by exercising the published account
 * through a second device.
 *
 * The other half is the **409**. The stub asserts the client's behaviour against a
 * hand-rolled `Error("relay POST /accounts failed: 409")`; the real transport
 * throws `relay register failed: 409`. The strings differ, so only a real relay
 * proves the client's fork still fires — and that fork is what stands between a
 * collision and a dead end.
 */
describe("binding a relay to a local-only account (bind → join → converge)", () => {
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

  /**
   * The state the increment is about: an account created with **no relay in
   * sight** — its own master key, its own doors, a username the user picked
   * locally, and nothing published anywhere.
   */
  async function localOnlyDevice(username = "ada") {
    const device = blankDevice();
    await runMigrations(device.driver);
    const { masterKey } = await ensureDeviceMasterKey({
      keyStore: device.keyStore,
      driver: device.driver,
    });
    const { recoveryKey } = await enableSync({
      keyStore: device.keyStore,
      driver: device.driver,
      username,
      password: PASSWORD,
      // No `relayUrl` — this is the local-only half of `model.md` §7.2.
      platform: "desktop",
    });
    return { ...device, masterKey, recoveryKey };
  }

  /** The bind, wired exactly as both clients' IPC handlers wire it. */
  function bind(device: ReturnType<typeof blankDevice>, username: string) {
    return bindRelayToAccount({
      keyStore: device.keyStore,
      driver: device.driver,
      username,
      relayUrl: baseUrl,
      registerWithRelay: (bootstrap) =>
        registerAccountWithRelay({ relayUrl: baseUrl, bootstrap }),
    });
  }

  /** A stranger who got to the handle first. */
  async function strangerHolding(username: string) {
    const stranger = await localOnlyDevice(username);
    await bind(stranger, username);
    return stranger;
  }

  // The headline claim, end to end: nothing about the account changed, and yet a
  // device that has never seen it can now log in with the username and password
  // that already existed and read what it holds.
  it("publishes a local-only account so a second device logs in and reads its data", async () => {
    const d1 = await localOnlyDevice();
    const ada = await reposFor(d1.driver).people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });

    const { accountId } = await bind(d1, "ada");

    // Bound, and the relay knows it under the handle the user picked locally.
    expect((await getSyncStatus({ driver: d1.driver })).relayUrl).toBe(baseUrl);
    expect(
      await createHttpSyncTransport({ baseUrl }).lookup("ada"),
    ).toMatchObject({ accountId });

    // Data it created *before* binding pushes like any other.
    await runAccountSync({
      keyStore: d1.keyStore,
      driver: d1.driver,
      masterKey: d1.masterKey,
    });

    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    const session = await joinAccount({
      keyStore: d2.keyStore,
      driver: d2.driver,
      transport: createHttpSyncTransport({ baseUrl }),
      relayUrl: baseUrl,
      username: "ada",
      password: PASSWORD, // the password the account has always had
      platform: "mobile",
    });
    // The account's own master key — binding published it, it did not mint one.
    expect(session.masterKey).toEqual(d1.masterKey);

    await runAccountSync({
      keyStore: d2.keyStore,
      driver: d2.driver,
      masterKey: session.masterKey,
    });
    expect(await reposFor(d2.driver).people.get(ada.id)).toEqual(ada);

    d1.db.close();
    d2.db.close();
  });

  /**
   * `bindRelayToAccount` computes exactly two values rather than reading them —
   * `wrap(recoveryKey, MK)` and the recovery verifier. The desktop suite checks
   * them against locally-derived bytes, which cannot catch a disagreement with the
   * relay's own hashing of the verifier. Recovery is the door a user reaches for
   * having already lost the other one, so it is the worst possible place for
   * "published, but not the shape the relay authenticates against".
   */
  it("publishes a recovery door the relay's own recovery route accepts", async () => {
    const d1 = await localOnlyDevice();
    const ada = await reposFor(d1.driver).people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await bind(d1, "ada");
    await runAccountSync({
      keyStore: d1.keyStore,
      driver: d1.driver,
      masterKey: d1.masterKey,
    });
    // The 24 words the user wrote down at account creation, before any relay.
    const phrase = encodeRecoveryPhrase(d1.recoveryKey);

    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    const session = await recoverAccountViaRelay({
      writePasswordSidecar: discardSidecar,
      keyStore: d2.keyStore,
      driver: d2.driver,
      relayUrl: baseUrl,
      username: "ada",
      recoveryPhrase: phrase,
      newPassword: "a brand new battery horse staple",
      platform: "mobile",
    });
    expect(session.masterKey).toEqual(d1.masterKey);

    await runAccountSync({
      keyStore: d2.keyStore,
      driver: d2.driver,
      masterKey: session.masterKey,
    });
    expect(await reposFor(d2.driver).people.get(ada.id)).toEqual(ada);

    d1.db.close();
    d2.db.close();
  });

  /**
   * **The increment's reason for existing.** A locally-chosen username may already
   * be somebody's, and the user who hits that must keep the working local-only
   * account they had — with the collision reaching the client as a *question*
   * rather than an error.
   */
  it("leaves the account local-only on a real 409, which the clients read as a taken username", async () => {
    const stranger = await strangerHolding("ada");
    const d1 = await localOnlyDevice("ada");
    const before = await getSyncStatus({ driver: d1.driver });

    const failure = await bind(d1, "ada").catch((cause: unknown) => cause);

    // The bridge to both clients' merge-or-rename fork. `isUsernameTakenError` is
    // a substring match on "409", and the message it has to match is the real
    // transport's — not the desktop stub's differently-worded one.
    expect(isUsernameTakenError(failure)).toBe(true);

    // Untouched: same account, still local-only, still under the chosen name. Had
    // the local write come first, this store would now point at a relay that never
    // accepted it, and every later sync would 401 with no way back.
    const after = await getSyncStatus({ driver: d1.driver });
    expect(after.accountId).toBe(before.accountId);
    expect(after.username).toBe("ada");
    expect(after.relayUrl).toBeUndefined();

    // And the stranger's account is exactly as it was — a refused bind must not
    // disturb the account it collided with.
    expect(
      await createHttpSyncTransport({ baseUrl }).lookup("ada"),
    ).toMatchObject({
      accountId: (await getSyncStatus({ driver: stranger.driver })).accountId,
    });

    stranger.db.close();
    d1.db.close();
  });

  // The rename half of the fork. There is no rename primitive because the handle
  // was never published — the second attempt is simply a first attempt.
  it("binds under another username after a real collision, and that account works", async () => {
    const stranger = await strangerHolding("ada");
    const d1 = await localOnlyDevice("ada");
    await expect(bind(d1, "ada")).rejects.toThrow(/409/);

    const { accountId } = await bind(d1, "ada-lovelace");
    expect((await getSyncStatus({ driver: d1.driver })).username).toBe(
      "ada-lovelace",
    );

    // Not merely "no error": the renamed account is separately reachable, and the
    // stranger still holds the handle that caused all this.
    const lookup = createHttpSyncTransport({ baseUrl });
    expect(await lookup.lookup("ada-lovelace")).toMatchObject({ accountId });
    expect((await lookup.lookup("ada")).accountId).not.toBe(accountId);

    stranger.db.close();
    d1.db.close();
  });

  /**
   * The crash window `bindRelayToAccount`'s doc-comment reasons about: the
   * register succeeds and the process dies before the one local write. The doc
   * says the retry converges because the relay is idempotent **on the account id**
   * — this is that claim, against the relay that has to honour it.
   */
  it("converges when a crash loses the local write after a successful register", async () => {
    const d1 = await localOnlyDevice();

    // Publish for real, then die before `bindRelay` can record it.
    await expect(
      bindRelayToAccount({
        keyStore: d1.keyStore,
        driver: d1.driver,
        username: "ada",
        relayUrl: baseUrl,
        registerWithRelay: async (bootstrap) => {
          await registerAccountWithRelay({ relayUrl: baseUrl, bootstrap });
          throw new Error("power cut");
        },
      }),
    ).rejects.toThrow(/power cut/);
    // Published, but the store does not know it.
    expect(
      (await getSyncStatus({ driver: d1.driver })).relayUrl,
    ).toBeUndefined();

    // The retry re-registers the same id → "exists" → 200, so it falls through to
    // the local write instead of colliding with itself.
    await bind(d1, "ada");
    expect((await getSyncStatus({ driver: d1.driver })).relayUrl).toBe(baseUrl);

    // Converged for real: the first registration is the one that survived, and the
    // password door it published still opens the account from a fresh device.
    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    const session = await joinAccount({
      keyStore: d2.keyStore,
      driver: d2.driver,
      transport: createHttpSyncTransport({ baseUrl }),
      relayUrl: baseUrl,
      username: "ada",
      password: PASSWORD,
      platform: "mobile",
    });
    expect(session.masterKey).toEqual(d1.masterKey);

    d1.db.close();
    d2.db.close();
  });
});

/**
 * The enumeration mitigation: the unauthenticated endpoints are per-IP
 * rate-limited (security-review.md §3). The username/password scheme can't remove
 * the existence oracle, but it throttles it.
 */
describe("relay rate limiting (unauthenticated endpoints)", () => {
  let server: Server;
  let db: DatabaseSync;
  let baseUrl: string;

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    // A deliberately tiny window so the third probe trips the limit.
    server = createRelayServer({
      store: createRelayStore(db),
      rateLimit: { max: 2, windowMs: 60_000 },
    });
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
  });

  afterEach(async () => {
    await close(server);
    db.close();
  });

  it("answers 429 once a client exceeds the lookup throttle", async () => {
    const probe = () =>
      fetch(`${baseUrl}/accounts/lookup?username=nobody`).then((r) => r.status);
    // First two unknown-username probes pass the throttle (and 404 on the miss).
    expect(await probe()).toBe(404);
    expect(await probe()).toBe(404);
    // The third within the window is throttled before the lookup runs.
    expect(await probe()).toBe(429);
  });
});

/**
 * The recovery-authed endpoints (`/accounts/recovery`, `/accounts/reset`) have
 * their own, tighter throttle (security-review.md §3): `reset` is state-changing
 * and both are gated only by the recovery verifier, so they're the brute-force
 * target. The throttle fires *before* the verifier check, so a wrong-token
 * guesser is limited — and it's a separate budget from the enumeration throttle.
 */
describe("relay rate limiting (recovery endpoints)", () => {
  let server: Server;
  let db: DatabaseSync;
  let baseUrl: string;

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    server = createRelayServer({
      store: createRelayStore(db),
      // Generous enumeration budget, but a tiny recovery budget: this proves the
      // two are independent (recovery 429s while lookup is nowhere near its cap).
      rateLimit: { max: 100, windowMs: 60_000 },
      recoveryRateLimit: { max: 2, windowMs: 60_000 },
    });
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
  });

  afterEach(async () => {
    await close(server);
    db.close();
  });

  it("throttles a recovery-verifier guesser before authenticating it", async () => {
    // A bogus Recovery token: it never authenticates (no such account), so each
    // attempt would 401 — but the throttle must cut in first on the third try.
    const guess = () =>
      fetch(`${baseUrl}/accounts/reset`, {
        method: "POST",
        headers: {
          authorization: `Recovery ${crypto.randomUUID()}.${Buffer.from(
            generateKey(),
          ).toString("base64")}`,
          "content-type": "application/json",
        },
        body: "{}",
      }).then((r) => r.status);
    expect(await guess()).toBe(401);
    expect(await guess()).toBe(401);
    // Third within the window is throttled before authenticateRecovery runs.
    expect(await guess()).toBe(429);
  });

  it("keeps the recovery budget separate from the enumeration budget", async () => {
    // Spend the entire recovery budget…
    const reset = () =>
      fetch(`${baseUrl}/accounts/reset`, {
        method: "POST",
        headers: {
          authorization: "Recovery x.y",
          "content-type": "application/json",
        },
        body: "{}",
      }).then((r) => r.status);
    await reset();
    await reset();
    expect(await reset()).toBe(429);
    // …the unauthenticated lookup throttle is untouched (its own counter).
    const lookup = await fetch(
      `${baseUrl}/accounts/lookup?username=nobody`,
    ).then((r) => r.status);
    expect(lookup).toBe(404);
  });
});

/**
 * Failed logins at `GET /accounts/bootstrap` are throttled per IP
 * (threat H2, README.md). Bootstrap isn't an enumeration oracle but *is* a password
 * oracle — a successful auth hands back `wrap(MK, KEK)` — so an attacker who has a
 * username (via the unauthed `lookup`) could otherwise grind passwords against it with
 * unlimited 401s. Only *failed* auths consume the budget, on its own counter, so a
 * legitimate join is never charged and the enumeration budget is untouched.
 */
describe("relay rate limiting (bootstrap endpoint)", () => {
  let server: Server;
  let db: DatabaseSync;
  let baseUrl: string;
  const accountId = crypto.randomUUID();
  const verifier = generateKey();
  const wrappedMk = new Uint8Array(48).fill(9);

  const bootstrap = (authorization: string) =>
    fetch(`${baseUrl}/accounts/bootstrap`, { headers: { authorization } }).then(
      (r) => r.status,
    );
  const wrongBearer = () =>
    `Bearer ${accountId}.${Buffer.from(generateKey()).toString("base64")}`;
  const rightBearer = () =>
    `Bearer ${accountId}.${Buffer.from(verifier).toString("base64")}`;

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    server = createRelayServer({
      store: createRelayStore(db),
      // Generous enumeration/recovery budgets, tiny bootstrap budget: proves the
      // bootstrap throttle fires on its own counter, independent of the others.
      rateLimit: { max: 100, windowMs: 60_000 },
      recoveryRateLimit: { max: 100, windowMs: 60_000 },
      bootstrapRateLimit: { max: 2, windowMs: 60_000 },
    });
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
    // A real account so a *valid* bootstrap can succeed (proving success is free).
    await createHttpSyncTransport({
      baseUrl,
      accountId,
      authVerifier: verifier,
    }).register({
      username: "ada",
      kdfSalt: generateSalt(),
      wrappedMasterKey: wrappedMk,
      wrappedRecoveryKey: new Uint8Array(48).fill(3),
      wrappedMasterKeyRecovery: new Uint8Array(48).fill(5),
      recoveryVerifier: generateKey(),
    });
  });

  afterEach(async () => {
    await close(server);
    db.close();
  });

  it("throttles a bootstrap password-guesser after the failure cap", async () => {
    // Wrong verifier → each attempt would 401, but the third within the window is
    // throttled instead (only failed auths consume the budget).
    expect(await bootstrap(wrongBearer())).toBe(401);
    expect(await bootstrap(wrongBearer())).toBe(401);
    expect(await bootstrap(wrongBearer())).toBe(429);
  });

  it("never charges a valid bootstrap, and keeps its budget separate", async () => {
    // Exhaust the failure budget…
    await bootstrap(wrongBearer());
    await bootstrap(wrongBearer());
    expect(await bootstrap(wrongBearer())).toBe(429);
    // …a correct bootstrap from the same IP still succeeds (success never touches
    // the counter, so a legit joining device is unaffected).
    expect(await bootstrap(rightBearer())).toBe(200);
    // …and the enumeration throttle is untouched (its own counter).
    const lookup = await fetch(
      `${baseUrl}/accounts/lookup?username=nobody`,
    ).then((r) => r.status);
    expect(lookup).toBe(404);
  });
});

/**
 * Proxy-aware client IP (security-review.md §3): behind a reverse proxy every
 * request shares the proxy's socket address, so the rate limiters must key on the
 * real client from `X-Forwarded-For` — but *only* when the request actually came
 * from a trusted proxy, or a forged header would mint unlimited buckets. These
 * tests run over a `127.0.0.1` socket, so `trustedProxies: ["loopback"]` makes
 * the test connection itself the "trusted proxy" whose XFF is honored.
 */
describe("relay rate limiting (proxy-aware client IP)", () => {
  let server: Server;
  let db: DatabaseSync;
  let baseUrl: string;

  async function start(
    rateLimit: { max: number; windowMs: number },
    trustedProxies?: string[],
  ): Promise<void> {
    db = new DatabaseSync(":memory:");
    server = createRelayServer({
      store: createRelayStore(db),
      rateLimit,
      trustedProxies,
    });
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
  }

  // A lookup probe carrying a chosen X-Forwarded-For; 404 on a miss, 429 throttled.
  const probe = (xff: string) =>
    fetch(`${baseUrl}/accounts/lookup?username=nobody`, {
      headers: { "x-forwarded-for": xff },
    }).then((r) => r.status);

  afterEach(async () => {
    await close(server);
    db.close();
  });

  it("keys per-client via X-Forwarded-For behind a trusted proxy", async () => {
    await start({ max: 1, windowMs: 60_000 }, ["loopback"]);
    // Client 1.1.1.1: first probe passes (404 miss), the second trips its bucket.
    expect(await probe("1.1.1.1")).toBe(404);
    expect(await probe("1.1.1.1")).toBe(429);
    // A different client has its own bucket — not collateral-throttled by 1.1.1.1.
    expect(await probe("2.2.2.2")).toBe(404);
  });

  it("ignores X-Forwarded-For when no proxy is trusted", async () => {
    await start({ max: 1, windowMs: 60_000 }); // trust nobody (the secure default)
    // Distinct XFF values, but the real 127.0.0.1 socket is the key, so a spoofed
    // header can't mint a fresh bucket: the second request is throttled.
    expect(await probe("1.1.1.1")).toBe(404);
    expect(await probe("2.2.2.2")).toBe(429);
  });

  it("trusts only the rightmost, proxy-appended X-Forwarded-For entry", async () => {
    await start({ max: 1, windowMs: 60_000 }, ["loopback"]);
    // The rightmost entry (added by our trusted proxy) is the real client; the
    // leftmost is client-supplied and spoofable. Same real client (1.1.1.1) under
    // a different forged leftmost → same bucket → throttled.
    expect(await probe("9.9.9.9, 1.1.1.1")).toBe(404);
    expect(await probe("8.8.8.8, 1.1.1.1")).toBe(429);
  });
});

/**
 * In-process TLS (Option B, threat H3): handed a cert + key, the relay
 * terminates HTTPS itself and serves the *same* handler over TLS. Driven with the
 * committed TEST-ONLY self-signed localhost cert (`test/fixtures`) so it needs no
 * tools at runtime — and validated against its own CA (not `rejectUnauthorized:
 * false`), so this also proves a genuine TLS handshake.
 */
describe("in-process TLS (Option B)", () => {
  const cert = readFileSync(
    new URL("./fixtures/localhost-test-only.crt", import.meta.url),
  );
  const key = readFileSync(
    new URL("./fixtures/localhost-test-only.key", import.meta.url),
  );

  let server: Server;
  let port: number;

  beforeEach(async () => {
    const store = createRelayStore(new DatabaseSync(":memory:"));
    server = createRelayServer({ store, tls: { cert, key } });
    port = await listen(server);
  });
  afterEach(() => close(server));

  /** One HTTPS request over TLS, validated against the fixture CA. */
  function httpsReq(opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; json: unknown }> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          host: "127.0.0.1",
          port,
          method: opts.method,
          path: opts.path,
          headers: opts.headers,
          ca: cert, // trust exactly the fixture — a real handshake must succeed
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              json: data === "" ? undefined : JSON.parse(data),
            }),
          );
        },
      );
      req.on("error", reject);
      if (opts.body !== undefined) req.write(opts.body);
      req.end();
    });
  }

  it("rejects an unauthenticated request over HTTPS (the handler runs over TLS)", async () => {
    const { status } = await httpsReq({
      method: "GET",
      path: "/sync/pull?since=0",
    });
    expect(status).toBe(401);
  });

  it("runs the full register → session → sync flow over HTTPS", async () => {
    const accountId = crypto.randomUUID();
    const verifierB64 = Buffer.from(generateKey()).toString("base64");

    const registered = await httpsReq({
      method: "POST",
      path: "/accounts",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId,
        username: "tls-ada",
        authVerifier: verifierB64,
        kdfSalt: Buffer.from(generateSalt()).toString("base64"),
        wrappedMasterKey: Buffer.from(WRAPPED_MK).toString("base64"),
      }),
    });
    expect(registered.status).toBe(200);

    const session = await httpsReq({
      method: "POST",
      path: "/accounts/session",
      headers: { authorization: `Bearer ${accountId}.${verifierB64}` },
    });
    expect(session.status).toBe(200);
    const { token } = session.json as { token: string };

    const pulled = await httpsReq({
      method: "GET",
      path: "/sync/pull?since=0",
      headers: { authorization: `Session ${token}` },
    });
    expect(pulled.status).toBe(200);
    expect((pulled.json as { records: unknown[] }).records).toEqual([]);
  });
});
