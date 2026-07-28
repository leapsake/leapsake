import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATABASE_KEY,
  RECOVERY_KEY,
  createInMemoryKeyStore,
  encodeRecoveryPhrase,
} from "@leapsake/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../src/main/db/open.js";
import { storeFileState } from "../src/main/db/sqlite-header.js";

/** A recovery-phrase prompt that always returns the given phrase. */
const give = (phrase: string) => () => Promise.resolve(phrase);
/** A prompt that should never be called (asserts no recovery was needed). */
const never = () => Promise.reject(new Error("unexpected recovery prompt"));

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
      requestRecoveryPhrase: never,
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
      requestRecoveryPhrase: never,
    });
    await driver.exec("CREATE TABLE t(x); INSERT INTO t VALUES (7)");
    await driver.close?.();

    // Not merely "it opened" — the bytes on disk are an unencrypted SQLite file.
    expect(storeFileState(dbPath)).toBe("plaintext");

    const reopened = await openAppDatabase({
      dbPath,
      custody: "open",
      keyStore: createInMemoryKeyStore(),
      requestRecoveryPhrase: never,
    });
    expect((await reopened.get<{ x: number }>("SELECT x FROM t"))?.x).toBe(7);
  });

  it("creates the per-account store directory on first launch", async () => {
    await openAppDatabase({
      dbPath,
      custody: "open",
      keyStore: createInMemoryKeyStore(),
      requestRecoveryPhrase: never,
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
      requestRecoveryPhrase: never,
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
        requestRecoveryPhrase: never,
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

  it("fresh install: mints the db-key, recovery key, and sidecar", async () => {
    const keyStore = createInMemoryKeyStore();
    const driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestRecoveryPhrase: never,
    });
    await driver.exec("CREATE TABLE t(x)");

    expect(await keyStore.getSecret(DATABASE_KEY)).toBeDefined();
    expect(await keyStore.getSecret(RECOVERY_KEY)).toBeDefined();
    expect(existsSync(`${dbPath}.recovery`)).toBe(true);
  });

  it("recovers the db-key from the sidecar when the enclave is wiped", async () => {
    // First launch writes the file + sidecar under a known recovery key.
    const keyStore = createInMemoryKeyStore();
    let driver = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestRecoveryPhrase: never,
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
      requestRecoveryPhrase: give(phrase),
    });

    // The data is intact and the enclave keys are restored.
    const row = await driver.get<{ x: number }>("SELECT x FROM t");
    expect(row?.x).toBe(42);
    expect(await wiped.getSecret(DATABASE_KEY)).toBeDefined();
    expect(await wiped.getSecret(RECOVERY_KEY)).toEqual(recoveryKey);
  });

  it("re-prompts until a correct phrase is supplied", async () => {
    const keyStore = createInMemoryKeyStore();
    const seeded = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestRecoveryPhrase: never,
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
      requestRecoveryPhrase: ({ error }) => {
        errors.push(error);
        attempt += 1;
        return Promise.resolve(attempt === 1 ? wrong : good);
      },
    });

    expect(attempt).toBe(2);
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toMatch(/doesn't open this database/);
  });

  it("fails clearly when the enclave is wiped and no sidecar exists", async () => {
    // An encrypted DB with no sidecar (a pre-feature Stage-2 file) + no enclave.
    const seededStore = createInMemoryKeyStore();
    const seeded = await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore: seededStore,
      requestRecoveryPhrase: never,
    });
    await seeded.exec("CREATE TABLE t(x)");
    await seeded.close?.();
    rmSync(`${dbPath}.recovery`);

    await expect(
      openAppDatabase({
        dbPath,
        custody: "protected",
        keyStore: createInMemoryKeyStore(),
        requestRecoveryPhrase: never,
      }),
    ).rejects.toThrow(/cannot be opened/);
  });

  it("writes a sidecar for an existing Stage-2 install that lacks one", async () => {
    const keyStore = createInMemoryKeyStore();
    await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestRecoveryPhrase: never,
    });
    // Drop the sidecar but keep the enclave key (the pre-feature state).
    rmSync(`${dbPath}.recovery`);
    expect(existsSync(`${dbPath}.recovery`)).toBe(false);

    await openAppDatabase({
      dbPath,
      custody: "protected",
      keyStore,
      requestRecoveryPhrase: never,
    });
    expect(existsSync(`${dbPath}.recovery`)).toBe(true);
  });
});
