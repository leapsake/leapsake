import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import {
  createInMemoryKeyStore,
  encodeRecoveryPhrase,
  generateKey,
  generateSalt,
} from "@leapsake/crypto";
import {
  createCore,
  enableSync,
  ensureDeviceMasterKey,
  joinAccount,
  reauthenticateViaRelay,
  recoverAccountViaRelay,
  reconcileOnJoin,
  runAccountSync,
  unlockWithPassword,
} from "@leapsake/core";
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
// Recovery escrow (model.md §6): opaque wrap(MK, recoveryKey) + a recovery
// verifier. Like WRAPPED_MK, the pre-join sync cases never unwrap them.
const WRAPPED_MK_RECOVERY = new Uint8Array(48).fill(5);
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
      wrappedMasterKeyRecovery: bootstrap.wrappedMasterKeyRecovery,
      recoveryVerifier: bootstrap.recoveryVerifier,
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
      wrappedMasterKeyRecovery: bootstrap.wrappedMasterKeyRecovery,
      recoveryVerifier: bootstrap.recoveryVerifier,
    });
    const phrase = encodeRecoveryPhrase(recoveryKey);
    const ada = await reposFor(d1.driver, mk.masterKey).people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await runAccountSync({ driver: d1.driver, masterKey: mk.masterKey });

    // --- Device 2: fresh, forgot the password — has only the recovery phrase. ---
    const d2 = blankDevice();
    await runMigrations(d2.driver);
    await ensureDeviceMasterKey({ keyStore: d2.keyStore, driver: d2.driver });
    const NEW_PASSWORD = "a brand new battery horse staple";
    const session = await recoverAccountViaRelay({
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
    await runAccountSync({ driver: d2.driver, masterKey: session.masterKey });
    expect(
      await reposFor(d2.driver, session.masterKey).people.get(ada.id),
    ).toEqual(ada);

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
      wrappedMasterKeyRecovery: bootstrap.wrappedMasterKeyRecovery,
      recoveryVerifier: bootstrap.recoveryVerifier,
    });
    const phrase = encodeRecoveryPhrase(recoveryKey);
    const ada = await reposFor(d1.driver, mk.masterKey).people.create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await runAccountSync({ driver: d1.driver, masterKey: mk.masterKey });

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
    await runAccountSync({ driver: d2.driver, masterKey: d2session.masterKey });
    expect(
      await reposFor(d2.driver, d2session.masterKey).people.get(ada.id),
    ).toEqual(ada);

    // --- Device 3: recover from the phrase, which resets the account password —
    //     the event that strands device 2's credential. ---
    const d3 = blankDevice();
    await runMigrations(d3.driver);
    await ensureDeviceMasterKey({ keyStore: d3.keyStore, driver: d3.driver });
    const NEW_PASSWORD = "a brand new battery horse staple";
    const d3session = await recoverAccountViaRelay({
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
      runAccountSync({ driver: d2.driver, masterKey: d2session.masterKey }),
    ).rejects.toThrow(/401/);

    // A wrong password fails at the relay's verifier check, before any local
    // mutation (the account row keeps its stale — and still-wrong — credential).
    await expect(
      reauthenticateViaRelay({
        keyStore: d2.keyStore,
        driver: d2.driver,
        password: "not the new password",
      }),
    ).rejects.toThrow();
    await expect(
      runAccountSync({ driver: d2.driver, masterKey: d2session.masterKey }),
    ).rejects.toThrow(/401/);

    // Device 2 re-authenticates with the new password — the MK is untouched — and
    // resumes syncing: it pulls a person device 3 pushes after the reset.
    await reauthenticateViaRelay({
      keyStore: d2.keyStore,
      driver: d2.driver,
      password: NEW_PASSWORD,
    });
    const grace = await reposFor(d3.driver, d3session.masterKey).people.create({
      firstName: "Grace",
      lastName: "Hopper",
    });
    await runAccountSync({ driver: d3.driver, masterKey: d3session.masterKey });
    await runAccountSync({ driver: d2.driver, masterKey: d2session.masterKey });
    expect(
      await reposFor(d2.driver, d2session.masterKey).people.get(grace.id),
    ).toEqual(grace);

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
    await runAccountSync({ driver: d1.driver, masterKey: mk1 });

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
    await runAccountSync({ driver: d2.driver, masterKey: session.masterKey });
    await runAccountSync({ driver: d1.driver, masterKey: mk1 });
    const onD1 = (await d1People.list()).map((p) => p.id);
    expect(onD1).toContain(bob.id);
    expect(onD1).toContain(localJane.id);
    expect(onD1).toContain(accountJane.id);

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
 * (security-findings.md H2). Bootstrap isn't an enumeration oracle but *is* a password
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
