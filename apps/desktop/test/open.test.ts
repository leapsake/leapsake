import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATABASE_KEY,
  RECOVERY_KEY,
  createInMemoryKeyStore,
  deriveKeyMaterial,
  encodeRecoveryPhrase,
  ensureRecoveryKey,
  generateSalt,
  sealDbKeyForPassword,
} from "@leapsake/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../src/main/db/open.js";
import { storeFileState } from "../src/main/db/sqlite-header.js";

/**
 * An unlock prompt that answers with one fixed secret — and **gives up after a few
 * tries**. The gate loops until a secret works, which is right for a human and a
 * trap for a test: a door that stops opening would otherwise hang the suite
 * forever instead of failing. Discovered exactly that way, by sabotaging the
 * recovery-key guard and watching the run never finish.
 */
const answerWith = (door: "password" | "phrase", secret: string) => {
  let attempts = 0;
  return () => {
    attempts += 1;
    return attempts > 3
      ? Promise.reject(new Error(`the ${door} door never opened`))
      : Promise.resolve({ door, secret });
  };
};
const givePhrase = (phrase: string) => answerWith("phrase", phrase);
const givePassword = (password: string) => answerWith("password", password);
/** A prompt that should never be called (asserts no unlock was needed). */
const never = () => Promise.reject(new Error("unexpected unlock prompt"));

/**
 * The Open custody state (`model.md` §7.2): no account, so no keys anywhere and a
 * plaintext store. These are slice 1's acceptance — "a fresh profile creates zero
 * keychain entries and a readable plaintext store" — expressed as tests.
 */
describe("openAppDatabase — Open (no account)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leapsake-open-none-"));
    // Exercises the per-account layout (§7.4): the directory does not exist yet.
    dbPath = join(dir, "stores", "local", "leapsake.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("touches the keychain not at all", async () => {
    const keyStore = createInMemoryKeyStore();
    const driver = await openAppDatabase({
      dbPath,
      custody: "open",
      keyStore,
      requestUnlock: never,
    });
    await driver.exec("CREATE TABLE t(x)");

    // The whole point of the decision: no db-key, no recovery key, no sidecar,
    // so losing the keychain costs this user nothing.
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();
    expect(await keyStore.getSecret(RECOVERY_KEY)).toBeUndefined();
    expect(existsSync(`${dbPath}.recovery`)).toBe(false);
  });

  it("writes a genuinely plaintext file, readable without any key", async () => {
    const driver = await openAppDatabase({
      dbPath,
      custody: "open",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: never,
    });
    await driver.exec("CREATE TABLE t(x); INSERT INTO t VALUES (7)");
    await driver.close?.();

    // Not merely "it opened" — the bytes on disk are an unencrypted SQLite file.
    expect(storeFileState(dbPath)).toBe("plaintext");

    const reopened = await openAppDatabase({
      dbPath,
      custody: "open",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: never,
    });
    expect((await reopened.get<{ x: number }>("SELECT x FROM t"))?.x).toBe(7);
  });

  it("creates the per-account store directory on first launch", async () => {
    await openAppDatabase({
      dbPath,
      custody: "open",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: never,
    });
    expect(existsSync(dbPath)).toBe(true);
  });

  // Refusing beats the two silent alternatives: a keyless open of ciphertext dies
  // deep in the first query with "file is not a database", and starting a fresh
  // store beside it would show the user an empty app with their data still there.
  it("refuses an encrypted file rather than opening or replacing it", async () => {
    const keyStore = createInMemoryKeyStore();
    const seeded = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestUnlock: never,
    });
    // Write, so the file is a real encrypted database rather than the 0-byte
    // placeholder SQLite leaves before the first write.
    await seeded.exec("CREATE TABLE t(x)");
    await seeded.close?.();

    await expect(
      openAppDatabase({
        dbPath,
        custody: "open",
        keyStore: createInMemoryKeyStore(),
        requestUnlock: never,
      }),
    ).rejects.toThrow(/encrypted, but no account was found/);
  });
});

describe("openAppDatabase", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leapsake-open-"));
    dbPath = join(dir, "leapsake.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Stand in for account creation, which is what establishes the recovery key in
   * production (`createLocalAccount` → `ensureRecoveryKey`) before any Protected
   * store is opened. The boot path deliberately **reads** that key and never mints
   * one — minting there would hand a password-unlocked device a fresh key and
   * silently invalidate the phrase its user wrote down.
   */
  async function withRecoveryKey() {
    const keyStore = createInMemoryKeyStore();
    await ensureRecoveryKey(keyStore);
    return keyStore;
  }

  it("fresh install: mints the db-key and seals the recovery sidecar", async () => {
    const keyStore = await withRecoveryKey();
    const driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestUnlock: never,
    });
    await driver.exec("CREATE TABLE t(x)");

    expect(await keyStore.getSecret(DATABASE_KEY)).toBeDefined();
    expect(existsSync(`${dbPath}.recovery`)).toBe(true);
  });

  it("seals no recovery sidecar when this device holds no recovery key", async () => {
    // The guard that protects a password-unlocked device: with no recovery key in
    // the enclave, boot must leave the door alone rather than mint a new key and
    // re-seal it — that would invalidate the user's 24 words.
    const keyStore = createInMemoryKeyStore();
    await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestUnlock: never,
    });

    expect(await keyStore.getSecret(RECOVERY_KEY)).toBeUndefined();
    expect(existsSync(`${dbPath}.recovery`)).toBe(false);
  });

  it("recovers the db-key from the sidecar when the enclave is wiped", async () => {
    // First launch writes the file + sidecar under a known recovery key.
    const keyStore = await withRecoveryKey();
    let driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestUnlock: never,
    });
    await driver.exec("CREATE TABLE t(x); INSERT INTO t VALUES (42)");
    const recoveryKey = (await keyStore.getSecret(RECOVERY_KEY)) as Uint8Array;
    const phrase = encodeRecoveryPhrase(recoveryKey);

    // Simulate keychain loss: a brand-new enclave with no secrets, same files.
    const wiped = createInMemoryKeyStore();
    driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: wiped,
      requestUnlock: givePhrase(phrase),
    });

    // The data is intact and the enclave keys are restored.
    const row = await driver.get<{ x: number }>("SELECT x FROM t");
    expect(row?.x).toBe(42);
    expect(await wiped.getSecret(DATABASE_KEY)).toBeDefined();
    expect(await wiped.getSecret(RECOVERY_KEY)).toEqual(recoveryKey);
  });

  it("re-prompts until a correct phrase is supplied", async () => {
    const keyStore = await withRecoveryKey();
    const seeded = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestUnlock: never,
    });
    await seeded.exec("CREATE TABLE t(x)");
    await seeded.close?.();
    const recoveryKey = (await keyStore.getSecret(RECOVERY_KEY)) as Uint8Array;
    const good = encodeRecoveryPhrase(recoveryKey);
    const wrong = encodeRecoveryPhrase(new Uint8Array(32).fill(9));

    const wiped = createInMemoryKeyStore();
    const errors: (string | undefined)[] = [];
    let attempt = 0;
    await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: wiped,
      requestUnlock: ({ error }) => {
        errors.push(error);
        attempt += 1;
        return Promise.resolve({
          door: "phrase" as const,
          secret: attempt === 1 ? wrong : good,
        });
      },
    });

    expect(attempt).toBe(2);
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toMatch(/doesn't open this database/);
  });

  it("fails clearly when the enclave is wiped and no sidecar exists", async () => {
    // An encrypted DB with no sidecar (a pre-feature Stage-2 file) + no enclave.
    const seededStore = await withRecoveryKey();
    const seeded = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: seededStore,
      requestUnlock: never,
    });
    await seeded.exec("CREATE TABLE t(x)");
    await seeded.close?.();
    rmSync(`${dbPath}.recovery`);

    await expect(
      openAppDatabase({
        dbPath,
        custody: "protected",
        keyStore: createInMemoryKeyStore(),
        requestUnlock: never,
      }),
    ).rejects.toThrow(/cannot be opened/);
  });

  it("writes a sidecar for an existing Stage-2 install that lacks one", async () => {
    const keyStore = await withRecoveryKey();
    await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestUnlock: never,
    });
    // Drop the sidecar but keep the enclave key (the pre-feature state).
    rmSync(`${dbPath}.recovery`);
    expect(existsSync(`${dbPath}.recovery`)).toBe(false);

    await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestUnlock: never,
    });
    expect(existsSync(`${dbPath}.recovery`)).toBe(true);
  });
});

/**
 * The **password door** (custody slice 5): the second, primary way back into an
 * encrypted store when the OS keychain is gone. Each positive is paired with its
 * negative, because a door that never actually checks the secret passes every
 * happy-path test ever written.
 */
describe("openAppDatabase — the password door", () => {
  let dir: string;
  let dbPath: string;
  const PASSWORD = "correct horse battery staple";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leapsake-open-pwd-"));
    dbPath = join(dir, "leapsake.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Stand in for account creation: a Protected store carrying both doors and a row
   * to prove the data survived. Mirrors the real order — the keys exist before the
   * store is opened, and the password sidecar is written beside it afterwards.
   */
  async function seedStoreWithBothDoors() {
    const keyStore = createInMemoryKeyStore();
    const recoveryKey = await ensureRecoveryKey(keyStore);
    const driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestUnlock: never,
    });
    await driver.exec("CREATE TABLE t(x); INSERT INTO t VALUES (42)");
    await driver.close?.();

    const dbKey = (await keyStore.getSecret(DATABASE_KEY)) as Uint8Array;
    const salt = generateSalt();
    const { kek } = deriveKeyMaterial(PASSWORD, salt);
    writeFileSync(
      `${dbPath}.password`,
      sealDbKeyForPassword({ dbKey, kek, salt }),
    );
    return { phrase: encodeRecoveryPhrase(recoveryKey) };
  }

  it("opens a wiped-keychain store from the password alone", async () => {
    await seedStoreWithBothDoors();

    const wiped = createInMemoryKeyStore();
    const driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: wiped,
      requestUnlock: givePassword(PASSWORD),
    });

    expect((await driver.get<{ x: number }>("SELECT x FROM t"))?.x).toBe(42);
    expect(await wiped.getSecret(DATABASE_KEY)).toBeDefined();
  });

  it("re-prompts on a wrong password, then opens on the right one", async () => {
    await seedStoreWithBothDoors();

    const errors: (string | undefined)[] = [];
    let attempt = 0;
    const driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: ({ error }) => {
        errors.push(error);
        attempt += 1;
        return Promise.resolve({
          door: "password" as const,
          secret: attempt === 1 ? "not the password" : PASSWORD,
        });
      },
    });

    expect(attempt).toBe(2);
    expect(errors[1]).toMatch(/password doesn't open/);
    expect((await driver.get<{ x: number }>("SELECT x FROM t"))?.x).toBe(42);
  });

  it("keeps the doors independent: a wrong password does not spoil the phrase", async () => {
    const { phrase } = await seedStoreWithBothDoors();

    let attempt = 0;
    const driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: () => {
        attempt += 1;
        return Promise.resolve(
          attempt === 1
            ? { door: "password" as const, secret: "wrong" }
            : { door: "phrase" as const, secret: phrase },
        );
      },
    });

    expect((await driver.get<{ x: number }>("SELECT x FROM t"))?.x).toBe(42);
  });

  it("leaves the recovery sidecar byte-identical after a password unlock", async () => {
    // The regression that would otherwise be invisible: a password unlock has no
    // recovery key, so a boot path that minted one would re-seal this file and
    // silently retire the phrase the user wrote down.
    await seedStoreWithBothDoors();
    const before = readFileSync(`${dbPath}.recovery`);

    await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: givePassword(PASSWORD),
    });

    expect(readFileSync(`${dbPath}.recovery`)).toEqual(before);
  });

  it("still opens from the phrase after a password unlock has happened", async () => {
    // The proof that the above actually matters: the words keep working.
    const { phrase } = await seedStoreWithBothDoors();
    await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: givePassword(PASSWORD),
    });

    const driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: givePhrase(phrase),
    });
    expect((await driver.get<{ x: number }>("SELECT x FROM t"))?.x).toBe(42);
  });

  it("offers only the doors that exist", async () => {
    // A store written before this slice has no password sidecar, and must fall
    // back to exactly the phrase-only gate it always had.
    const { phrase } = await seedStoreWithBothDoors();
    rmSync(`${dbPath}.password`);

    const offered: { password: boolean; phrase: boolean }[] = [];
    await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: ({ doors }) => {
        offered.push(doors);
        return Promise.resolve({ door: "phrase" as const, secret: phrase });
      },
    });

    expect(offered).toEqual([{ password: false, phrase: true }]);
  });
});
