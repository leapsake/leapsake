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

/** A recovery-phrase prompt that always returns the given phrase. */
const give = (phrase: string) => () => Promise.resolve(phrase);
/** A prompt that should never be called (asserts no recovery was needed). */
const never = () => Promise.reject(new Error("unexpected recovery prompt"));

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
    await openAppDatabase({ dbPath, keyStore, requestRecoveryPhrase: never });
    const recoveryKey = (await keyStore.getSecret(RECOVERY_KEY)) as Uint8Array;
    const good = encodeRecoveryPhrase(recoveryKey);
    const wrong = encodeRecoveryPhrase(new Uint8Array(32).fill(9));

    const wiped = createInMemoryKeyStore();
    const errors: (string | undefined)[] = [];
    let attempt = 0;
    await openAppDatabase({
      dbPath,
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
    const seeded = createInMemoryKeyStore();
    await openAppDatabase({
      dbPath,
      keyStore: seeded,
      requestRecoveryPhrase: never,
    });
    rmSync(`${dbPath}.recovery`);

    await expect(
      openAppDatabase({
        dbPath,
        keyStore: createInMemoryKeyStore(),
        requestRecoveryPhrase: never,
      }),
    ).rejects.toThrow(/cannot be opened/);
  });

  it("writes a sidecar for an existing Stage-2 install that lacks one", async () => {
    const keyStore = createInMemoryKeyStore();
    await openAppDatabase({ dbPath, keyStore, requestRecoveryPhrase: never });
    // Drop the sidecar but keep the enclave key (the pre-feature state).
    rmSync(`${dbPath}.recovery`);
    expect(existsSync(`${dbPath}.recovery`)).toBe(false);

    await openAppDatabase({ dbPath, keyStore, requestRecoveryPhrase: never });
    expect(existsSync(`${dbPath}.recovery`)).toBe(true);
  });
});
