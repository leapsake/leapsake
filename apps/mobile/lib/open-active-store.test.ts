import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import {
  type SqliteDriver,
  type UnlockAnswer,
  createLocalAccount,
  runMigrations,
  unlockStore,
} from "@leapsake/core";
import {
  DATABASE_KEY,
  type KeyStore,
  RECOVERY_KEY,
  createInMemoryKeyStore,
  decodeRecoveryPhrase,
  rawKeyLiteral,
} from "@leapsake/crypto";
import {
  UNAUTHENTICATED_STORE_SLOT,
  createAccountRoster,
  storePath,
} from "@leapsake/store-layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sqliteDriver } from "../test/node-sqlite-driver";
import { forgetAccountOnThisDevice } from "./forget-account";
import { forgetActiveAccount } from "./forget-active-account";
import { type BootDoors, openActiveStore } from "./open-active-store";

const PASSWORD = "correct horse battery staple";

/** An in-memory key store that records every write and delete. */
function recordingKeyStore(): KeyStore & { writes: string[] } {
  const inner = createInMemoryKeyStore();
  const writes: string[] = [];
  return {
    writes,
    getSecret: (id) => inner.getSecret(id),
    async setSecret(id, bytes) {
      writes.push(`set ${id}`);
      await inner.setSecret(id, bytes);
    },
    async deleteSecret(id) {
      writes.push(`delete ${id}`);
      await inner.deleteSecret(id);
    },
  };
}

/** Answers every unlock request with one secret; fails after three tries. */
function answerWith(answer: UnlockAnswer) {
  let asked = 0;
  return () =>
    ++asked > 3
      ? Promise.reject(new Error(`the ${answer.door} door never opened`))
      : Promise.resolve(answer);
}
const neverAsk = () => Promise.reject(new Error("unexpected unlock prompt"));

/** One phone: its files in a temp dir, a roster, and per-account doors. */
function makeDevice() {
  const dir = mkdtempSync(join(tmpdir(), "leapsake-mobile-boot-"));
  let rosterText: string | undefined;
  const roster = createAccountRoster({
    read: async () => rosterText,
    write: async (text) => {
      rosterText = text;
    },
  });
  const doors = new Map<
    string,
    { password?: Uint8Array; recovery?: Uint8Array }
  >();
  const opened: SqliteDriver[] = [];
  let keyStore = recordingKeyStore();

  const fileOf = (path: string) => join(dir, path);
  const doorsFor = (
    accountId: string,
  ): BootDoors & { destroy(): Promise<void> } => {
    if (!doors.has(accountId)) doors.set(accountId, {});
    const held = doors.get(accountId)!;
    return {
      readPassword: async () => held.password,
      readRecovery: async () => held.recovery,
      writeRecovery: async (bytes) => {
        held.recovery = bytes;
      },
      destroy: async () => {
        doors.delete(accountId);
      },
    };
  };

  async function boot(ask: typeof neverAsk | ReturnType<typeof answerWith>) {
    const result = await openActiveStore({
      keyStore,
      listAccounts: () => roster.list(),
      doorsFor,
      destroyStore: async (path) => rmSync(fileOf(path), { force: true }),
      async openStore(path, dbKey) {
        mkdirSync(dirname(fileOf(path)), { recursive: true });
        const db = new Database(fileOf(path));
        if (dbKey !== undefined) {
          db.pragma("cipher='sqlcipher'");
          db.pragma(`key="${rawKeyLiteral(dbKey)}"`);
          db.pragma("user_version");
        }
        const driver = sqliteDriver(db);
        opened.push(driver);
        await runMigrations(driver);
        return driver;
      },
      ask,
      onUnlocked: () => {},
      platform: "ios",
    });
    return result;
  }

  /** First run, then account creation and its store conversion, then the
   *  Authenticated launch that follows. Returns the phrase shown once. */
  async function createAccount(): Promise<{
    phrase: string;
    accountId: string;
  }> {
    const first = await boot(neverAsk);
    const created = await createLocalAccount({
      keyStore,
      driver: first.driver,
      username: "george",
      password: PASSWORD,
      platform: "ios",
    });
    await first.driver.exec(
      "CREATE TABLE marker(x); INSERT INTO marker VALUES (42)",
    );
    await first.driver.close?.();

    const target = fileOf(storePath(created.accountId));
    mkdirSync(dirname(target), { recursive: true });
    renameSync(fileOf(storePath(UNAUTHENTICATED_STORE_SLOT)), target);
    const converting = new Database(target);
    converting.pragma("cipher='sqlcipher'");
    converting.pragma(`rekey="${rawKeyLiteral(created.dbKey)}"`);
    converting.close();

    doorsFor(created.accountId);
    doors.get(created.accountId)!.password = created.passwordSidecar;
    await roster.add({
      id: created.accountId,
      username: "george",
      createdAt: new Date().toISOString(),
    });
    await boot(neverAsk);
    return { phrase: created.recoveryPhrase, accountId: created.accountId };
  }

  return {
    get keyStore() {
      return keyStore;
    },
    /** A new phone, or a transfer: the whole keychain gone, files intact. */
    loseEverything() {
      keyStore = recordingKeyStore();
    },
    roster,
    boot,
    createAccount,
    doorsFor,
    hasDoors: (accountId: string) => doors.has(accountId),
    storeExists: (path: string) => existsSync(fileOf(path)),
    deleteStore: async (path: string) => rmSync(fileOf(path), { force: true }),
    recoveryDoor: (accountId: string) => doors.get(accountId)?.recovery,
    marker: async (driver: SqliteDriver) =>
      (await driver.get<{ x: number }>("SELECT x FROM marker"))?.x,
    async cleanup() {
      for (const driver of opened) {
        try {
          await driver.close?.();
        } catch {
          // Already closed by the test.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Whether a recovery door opens with the phrase the user wrote down. */
async function opensWithPhrase(door: Uint8Array | undefined, phrase: string) {
  expect(door).toBeDefined();
  const { dbKey } = await unlockStore(
    { phrase: door },
    answerWith({ door: "phrase", secret: phrase }),
  );
  return dbKey;
}

describe("openActiveStore", () => {
  let device: ReturnType<typeof makeDevice>;

  beforeEach(() => {
    device = makeDevice();
  });

  afterEach(async () => {
    await device.cleanup();
  });

  it("opens a first run keyless at stores/local/, writing nothing to the key store", async () => {
    const { activeStore, doors, established } = await device.boot(neverAsk);

    expect(activeStore).toEqual({
      custody: "plaintext",
      path: storePath(UNAUTHENTICATED_STORE_SLOT),
    });
    expect(doors).toBeUndefined();
    expect(established).toEqual({ state: "ok", keySession: undefined });
    expect(device.keyStore.writes).toEqual([]);
  });

  it("opens an Authenticated store without asking when its db-key is held", async () => {
    const { accountId } = await device.createAccount();

    const { activeStore, driver, established } = await device.boot(neverAsk);

    expect(activeStore.path).toBe(storePath(accountId));
    expect(await device.marker(driver)).toBe(42);
    expect(established.state).toBe("ok");
  });

  it("leaves the recovery door alone after a password unlock that lost every key", async () => {
    const { phrase, accountId } = await device.createAccount();
    const before = device.recoveryDoor(accountId);
    device.loseEverything();

    const { driver } = await device.boot(
      answerWith({ door: "password", secret: PASSWORD }),
    );

    expect(await device.marker(driver)).toBe(42);
    expect(device.recoveryDoor(accountId)).toEqual(before);
    expect(await device.keyStore.getSecret(RECOVERY_KEY)).toBeUndefined();
    await opensWithPhrase(device.recoveryDoor(accountId), phrase);
  });

  it("reseals the recovery door under the surviving key after a password unlock", async () => {
    const { phrase, accountId } = await device.createAccount();
    const before = device.recoveryDoor(accountId);
    await device.keyStore.deleteSecret(DATABASE_KEY);

    const { driver } = await device.boot(
      answerWith({ door: "password", secret: PASSWORD }),
    );

    expect(await device.marker(driver)).toBe(42);
    expect(device.recoveryDoor(accountId)).not.toEqual(before);
    const dbKey = await opensWithPhrase(device.recoveryDoor(accountId), phrase);
    expect(dbKey).toEqual(await device.keyStore.getSecret(DATABASE_KEY));
  });

  it("re-adopts the recovery key after a phrase unlock", async () => {
    const { phrase, accountId } = await device.createAccount();
    device.loseEverything();

    const { driver, established } = await device.boot(
      answerWith({ door: "phrase", secret: phrase }),
    );

    expect(await device.marker(driver)).toBe(42);
    expect(established.state).toBe("ok");
    expect(await device.keyStore.getSecret(RECOVERY_KEY)).toEqual(
      decodeRecoveryPhrase(phrase),
    );
    expect(device.keyStore.writes).toContain(`set ${RECOVERY_KEY}`);
    await opensWithPhrase(device.recoveryDoor(accountId), phrase);
  });

  it("opens keyless at stores/local/ on the boot after a forget, writing nothing to the key store", async () => {
    const { accountId } = await device.createAccount();
    const booted = await device.boot(neverAsk);
    await booted.driver.close?.();
    await forgetAccountOnThisDevice({
      keyStore: device.keyStore,
      roster: device.roster,
      accountId,
      storeName: storePath(accountId),
      deleteStore: device.deleteStore,
      deleteDoors: () => device.doorsFor(accountId).destroy(),
    });
    const writesBefore = device.keyStore.writes.length;

    const { activeStore, driver, doors, established } =
      await device.boot(neverAsk);

    expect(activeStore).toEqual({
      custody: "plaintext",
      path: storePath(UNAUTHENTICATED_STORE_SLOT),
    });
    expect(doors).toBeUndefined();
    expect(established).toEqual({ state: "ok", keySession: undefined });
    expect(device.keyStore.writes.slice(writesBefore)).toEqual([]);
    expect(
      await driver.get("SELECT name FROM sqlite_master WHERE name = 'marker'"),
    ).toBeUndefined();
    expect(device.storeExists(storePath(accountId))).toBe(false);
  });
});

describe("forgetActiveAccount", () => {
  const OTHER = "11111111-2222-3333-4444-555555555555";
  let device: ReturnType<typeof makeDevice>;

  beforeEach(() => {
    device = makeDevice();
  });

  afterEach(async () => {
    await device.cleanup();
  });

  const forget = (
    booted: Awaited<ReturnType<typeof device.boot>>,
    onClosing = () => {},
  ) =>
    forgetActiveAccount(booted.activeStore, booted.driver, {
      keyStore: device.keyStore,
      roster: device.roster,
      deleteStore: device.deleteStore,
      doorsFor: device.doorsFor,
      onClosing,
    });

  it("deletes the active account's store and doors, and leaves another account's doors", async () => {
    const { accountId } = await device.createAccount();
    const booted = await device.boot(neverAsk);
    await device.roster.add({
      id: OTHER,
      username: "mary",
      createdAt: new Date().toISOString(),
    });
    await device.doorsFor(OTHER).writeRecovery(new Uint8Array([1]));

    await forget(booted);

    expect(device.storeExists(storePath(accountId))).toBe(false);
    expect(device.hasDoors(accountId)).toBe(false);
    expect(device.hasDoors(OTHER)).toBe(true);
    expect((await device.roster.list()).map((a) => a.id)).toEqual([OTHER]);
  });

  it("refuses an Unauthenticated store and touches nothing", async () => {
    const booted = await device.boot(neverAsk);
    let closing = false;

    await expect(
      forget(booted, () => {
        closing = true;
      }),
    ).rejects.toThrow(/no account on this device to forget/);

    expect(closing).toBe(false);
    expect(device.storeExists(storePath(UNAUTHENTICATED_STORE_SLOT))).toBe(
      true,
    );
    expect(await booted.driver.get("SELECT 1 AS one")).toEqual({ one: 1 });
  });
});
