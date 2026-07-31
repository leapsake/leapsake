import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DATABASE_KEY,
  type KeyStore,
  createInMemoryKeyStore,
} from "@leapsake/crypto";
import {
  type AccountBootstrap,
  type AccountBootstrapChannel,
  type KeySession,
  type PasswordDoorWriter,
  type RecoveryChannel,
  type SqliteDriver,
  enableSync,
  joinAccount,
  recoverAccount,
  runMigrations,
  sealPasswordDoor,
} from "@leapsake/core";
import {
  createDeviceRepo,
  createKeyWrapRepo,
  createPeopleRepo,
} from "@leapsake/data";
import {
  UNAUTHENTICATED_STORE_SLOT,
  ROSTER_PATH,
  createAccountRoster,
  resolveActiveStore,
  storePath,
} from "@leapsake/store-layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adoptAccountOnThisDevice } from "../../src/main/db/adopt-account-flow.js";
import {
  type UnlockAnswer,
  type UnlockRequest,
  openAppDatabase,
} from "../../src/main/db/open.js";
import { jsonFileStorage } from "../../src/main/db/roster-storage.js";
import { storeFileState } from "../../src/main/db/sqlite-header.js";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * **Adopting an existing account** (`model.md` §7.1) — slice 6's acceptance, and
 * the sibling of `create-account.test.ts`: an Unauthenticated store with real data joins (or
 * recovers) an account that already exists, and comes out encrypted, rostered, and
 * openable by *this device's own password*.
 *
 * Until this landed, joining adopted the account master key and left the store
 * plaintext, so every device past the first was unencrypted at rest and had no
 * password door at all.
 *
 * The relay half runs against in-memory channels (the `fakeRelay` shape borrowed
 * from `account-join.test.ts`), and `sealLikeCore` reproduces core's
 * `sealPasswordDoorIfProtected` — including its skip — so the interaction the
 * flow depends on is the one under test: **minting the db-key before the relay
 * call is what turns that skip into a real door.**
 */

const USERNAME = "Ada"; // mixed-case on purpose: the account stores it normalized
const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a different correct horse";
const RELAY_URL = "https://relay.example";

const never = () => Promise.reject(new Error("unexpected recovery prompt"));

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

let userData: string;
let keyStore: KeyStore;
let bootstrap: AccountBootstrap;
let wrappedMasterKeyRecovery: Uint8Array;
let recoveryKey: Uint8Array;

const rosterFor = (dir: string) =>
  createAccountRoster(jsonFileStorage(join(dir, ROSTER_PATH)));

const cleanups: Array<() => void> = [];

/** Device 1: the account this device is about to join, and its relay bootstrap. */
async function existingAccount(): Promise<void> {
  const { driver, cleanup } = makeEncryptedTestDriver();
  cleanups.push(cleanup);
  await runMigrations(driver);
  const enabled = await enableSync({
    keyStore: createInMemoryKeyStore(),
    driver,
    username: USERNAME,
    password: PASSWORD,
    relayUrl: RELAY_URL,
    platform: "desktop",
  });
  bootstrap = enabled.bootstrap;
  recoveryKey = enabled.recoveryKey;
  // The relay's recovery escrow — `wrap(MK, recoveryKey)`, which is what a
  // recovering device fetches in place of the password bootstrap.
  const wrap = await createKeyWrapRepo(driver).getActive({
    wrappedKind: "master",
    principalKind: "recovery",
  });
  wrappedMasterKeyRecovery = wrap!.ciphertext;
}

function fakeRelay(): AccountBootstrapChannel {
  return {
    async lookup(username) {
      if (username !== bootstrap.username) throw new Error("404 not found");
      return { accountId: bootstrap.accountId, kdfSalt: bootstrap.kdfSalt };
    },
    async fetchBootstrap({ accountId, authVerifier }) {
      if (
        accountId !== bootstrap.accountId ||
        !equal(authVerifier, bootstrap.authVerifier)
      ) {
        throw new Error("401 unauthorized");
      }
      return {
        wrappedMasterKey: bootstrap.wrappedMasterKey,
        wrappedRecoveryKey: bootstrap.wrappedRecoveryKey,
      };
    },
  };
}

function fakeRecoveryRelay(): RecoveryChannel {
  return {
    async lookup(username) {
      if (username !== bootstrap.username) throw new Error("404 not found");
      return { accountId: bootstrap.accountId, kdfSalt: bootstrap.kdfSalt };
    },
    async fetchRecovery() {
      return wrappedMasterKeyRecovery;
    },
    async resetCredentials() {},
  };
}

/**
 * `sealPasswordDoorIfProtected` (`packages/core/src/sync.ts`), reproduced: core
 * seals this device's password door after a join/recover, and **skips while there
 * is no db-key to seal**. Keeping the skip here is the point — it is what makes
 * the "guard" case below meaningful.
 */
async function sealLikeCore(
  driver: SqliteDriver,
  password: string,
  write: PasswordDoorWriter,
): Promise<void> {
  if ((await keyStore.getSecret(DATABASE_KEY)) === undefined) return;
  await write(await sealPasswordDoor({ keyStore, driver, password }));
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), "leapsake-adopt-"));
  keyStore = createInMemoryKeyStore();
  await existingAccount();
});
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  rmSync(userData, { recursive: true, force: true });
});

/** An Unauthenticated store holding one person — this device before it joins anything. */
async function openStoreWithData(): Promise<{
  driver: SqliteDriver;
  path: string;
}> {
  const path = join(userData, storePath(UNAUTHENTICATED_STORE_SLOT));
  const driver = await openAppDatabase({
    dbPath: path,
    custody: "plaintext",
    keyStore,
    requestUnlock: never,
  });
  await runMigrations(driver);
  await createPeopleRepo(driver).create({
    firstName: "Grace",
    lastName: "Hopper",
  });
  return { driver, path };
}

/** The two flows under test, wired exactly as the IPC handlers wire them. */
function adoptOnThisDevice(
  driver: SqliteDriver,
  adopt: (write: PasswordDoorWriter) => Promise<KeySession>,
) {
  return adoptAccountOnThisDevice({
    keyStore,
    driver,
    roster: rosterFor(userData),
    userDataPath: userData,
    username: USERNAME,
    adopt,
    closeStore: async () => {
      await driver.close?.();
    },
  });
}

const joinFlow = (driver: SqliteDriver) =>
  adoptOnThisDevice(driver, async (write) => {
    const session = await joinAccount({
      keyStore,
      driver,
      transport: fakeRelay(),
      relayUrl: RELAY_URL,
      username: USERNAME,
      password: PASSWORD,
      platform: "desktop",
    });
    await sealLikeCore(driver, PASSWORD, write);
    return session;
  });

const recoverFlow = (driver: SqliteDriver) =>
  adoptOnThisDevice(driver, async (write) => {
    const session = await recoverAccount({
      keyStore,
      driver,
      transport: fakeRecoveryRelay(),
      relayUrl: RELAY_URL,
      username: USERNAME,
      recoveryKey,
      newPassword: NEW_PASSWORD,
      platform: "desktop",
    });
    await sealLikeCore(driver, NEW_PASSWORD, write);
    return session;
  });

/**
 * Re-open through the ordinary boot path, exactly as the next launch would —
 * asserting on the way that it is booting the *converted* store. Without that
 * check every caller would still pass against an unconverted device, by quietly
 * re-opening the plaintext original the roster never stopped naming.
 */
async function bootTheDevice(
  requestUnlock: (request: UnlockRequest) => Promise<UnlockAnswer> = never,
): Promise<{ driver: SqliteDriver; path: string }> {
  const accounts = await rosterFor(userData).list();
  const resolved = resolveActiveStore({ accounts });
  expect(resolved.custody).toBe("encrypted");
  expect(resolved.path).toBe(storePath(bootstrap.accountId));
  const path = join(userData, resolved.path);
  const driver = await openAppDatabase({
    dbPath: path,
    custody: resolved.custody,
    keyStore,
    requestUnlock,
  });
  return { driver, path };
}

describe.each([
  { label: "join", run: joinFlow, password: PASSWORD },
  { label: "recover", run: recoverFlow, password: NEW_PASSWORD },
])("adopting an account by $label", ({ run, password }) => {
  it("turns the Unauthenticated store into an encrypted per-account store", async () => {
    const { driver, path: openPath } = await openStoreWithData();

    await run(driver);

    const encryptedPath = join(userData, storePath(bootstrap.accountId));
    expect(storeFileState(encryptedPath)).toBe("encrypted");
    // Acceptance: plaintext store in, encrypted store out, original gone.
    expect(existsSync(openPath)).toBe(false);
    expect(
      existsSync(join(userData, "stores", UNAUTHENTICATED_STORE_SLOT)),
    ).toBe(false);
  });

  it("mints the db-key that was deliberately absent while Unauthenticated", async () => {
    const { driver } = await openStoreWithData();
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();

    await run(driver);

    expect(await keyStore.getSecret(DATABASE_KEY)).toBeDefined();
  });

  it("records the account in the roster, so the next boot is Authenticated", async () => {
    const { driver } = await openStoreWithData();
    await run(driver);

    const accounts = await rosterFor(userData).list();
    expect(accounts.map((a) => a.id)).toEqual([bootstrap.accountId]);
    expect(accounts[0].username).toBe("ada"); // the store's normalized form

    expect(resolveActiveStore({ accounts }).custody).toBe("encrypted");
  });

  it("leaves a store the boot path opens, with the data intact", async () => {
    const { driver } = await openStoreWithData();
    await run(driver);

    const { driver: reopened } = await bootTheDevice();
    await runMigrations(reopened); // a no-op if user_version came across

    const people = await createPeopleRepo(reopened).list();
    expect(people.map((p) => p.firstName)).toEqual(["Grace"]);

    const account = await reopened.get<{ id: string }>(
      "SELECT id FROM account LIMIT 1",
    );
    expect(account?.id).toBe(bootstrap.accountId);
    await reopened.close?.();
  });

  // Slice 9 routed join and recover through the same enclave-adoption primitive
  // the repair path uses, replacing two hand-written copies. Both properties that
  // rewrite could have broken: the account's key must end up bound exactly once,
  // and the registration that runs *after* it must still carry label/platform —
  // `register` returns an existing row untouched, so an adoption that registered
  // on its own behalf first would silently discard them.
  it("binds the adopted key once and registers the device with its platform", async () => {
    const { driver } = await openStoreWithData();
    await run(driver);

    const { driver: reopened } = await bootTheDevice();
    const enclave = await reopened.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE principal_kind = 'enclave' " +
        "AND deleted_at IS NULL",
    );
    expect(enclave[0]?.n).toBe(1);

    const devices = await createDeviceRepo(reopened).list();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.platform).toBe("desktop");
    await reopened.close?.();
  });

  // Slice 5's promise, now true on a device that never created the account: the
  // password door is sealed by the adopt, the recovery door by the first
  // Authenticated open.
  it("writes both unlock doors beside the converted store", async () => {
    const { driver } = await openStoreWithData();
    await run(driver);

    const encryptedPath = join(userData, storePath(bootstrap.accountId));
    expect(existsSync(`${encryptedPath}.password`)).toBe(true);

    const { driver: reopened } = await bootTheDevice();
    await reopened.close?.();
    expect(existsSync(`${encryptedPath}.recovery`)).toBe(true);
  });

  // The line status.md's acceptance ends on. A joined device that loses its
  // keychain must come back from the password its own user typed.
  it("opens from this device's own password after the keychain is wiped", async () => {
    const { driver } = await openStoreWithData();
    await run(driver);
    await (await bootTheDevice()).driver.close?.(); // seal the recovery door too

    await keyStore.deleteSecret(DATABASE_KEY);

    let asked: { password: boolean; phrase: boolean } | undefined;
    const { driver: unlocked } = await bootTheDevice(async (request) => {
      asked = request.doors;
      return { door: "password", secret: password };
    });

    expect(asked).toEqual({ password: true, phrase: true });
    const people = await createPeopleRepo(unlocked).list();
    expect(people.map((p) => p.firstName)).toEqual(["Grace"]);
    await unlocked.close?.();
  });

  // A relay that refuses (wrong password, unreachable) must leave the device
  // exactly as it was — nothing on disk has moved by then.
  it("leaves the device Unauthenticated when the relay refuses", async () => {
    const { driver, path: openPath } = await openStoreWithData();

    await expect(
      adoptOnThisDevice(driver, async () => {
        throw new Error("401 unauthorized");
      }),
    ).rejects.toThrow(/401/);

    expect(storeFileState(openPath)).toBe("plaintext");
    expect(await rosterFor(userData).list()).toEqual([]);
    expect(storeFileState(join(userData, storePath(bootstrap.accountId)))).toBe(
      "absent",
    );
    await driver.close?.();
  });

  // A crash between the conversion and the roster entry leaves an encrypted store
  // nobody claims. The retry must clear it rather than trip the overwrite guard.
  it("clears a stranded destination no roster entry claims", async () => {
    const { driver } = await openStoreWithData();
    const encryptedPath = join(userData, storePath(bootstrap.accountId));
    mkdirSync(dirname(encryptedPath), { recursive: true });
    writeFileSync(encryptedPath, "leftovers from a crashed attempt");
    expect(storeFileState(encryptedPath)).not.toBe("absent");

    await run(driver);

    expect(storeFileState(encryptedPath)).toBe("encrypted");
    const { driver: reopened } = await bootTheDevice();
    expect((await createPeopleRepo(reopened).list()).length).toBe(1);
    await reopened.close?.();
  });
});

describe("adopting an account — the password-door guard", () => {
  // The flow mints the db-key precisely so core stops skipping. If that ever
  // regresses, the device would convert with only a recovery phrase to open it —
  // so refuse *before* anything on disk moves rather than ship that silently.
  it("refuses to convert when the adopt seals no password door", async () => {
    const { driver, path: openPath } = await openStoreWithData();

    await expect(
      adoptOnThisDevice(driver, async () =>
        joinAccount({
          keyStore,
          driver,
          transport: fakeRelay(),
          relayUrl: RELAY_URL,
          username: USERNAME,
          password: PASSWORD,
          platform: "desktop",
        }),
      ),
    ).rejects.toThrow(/password door/);

    expect(storeFileState(openPath)).toBe("plaintext");
    expect(await rosterFor(userData).list()).toEqual([]);
    await driver.close?.();
  });
});

/**
 * Joining is an **Unauthenticated** device's act. There used to be a branch here that
 * adopted in place on an already-Authenticated device, reachable only via the
 * "Disconnect account" button that left a device reporting no account while its
 * roster still named one. With that button gone the state is unreachable, and
 * refusing is the honest replacement — adopting a second account into a store
 * still homed under the first one's id was never worth producing.
 */
describe("adopting an account — the Unauthenticated-device guard", () => {
  it("refuses when this device already holds an account", async () => {
    const { driver, path: openPath } = await openStoreWithData();
    // Make the device Authenticated the way account creation does: the Unauthenticated store
    // is gone, so `storeFileState` reports "absent" rather than "plaintext".
    await driver.close?.();
    rmSync(dirname(openPath), { recursive: true, force: true });

    await expect(
      adoptOnThisDevice(driver, () => {
        throw new Error("must refuse before reaching the relay");
      }),
    ).rejects.toThrow(/already holds an account/);
  });
});
