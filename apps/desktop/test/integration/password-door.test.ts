import { createInMemoryKeyStore } from "@leapsake/crypto";
import {
  type SqliteDriver,
  createAccountRepo,
  runMigrations,
} from "@leapsake/data";
import {
  enableSync,
  ensureDeviceMasterKey,
  unlockWithPassword,
  unlockWithRecoveryKey,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Custody Phase 1/2: the password unlock door. Proves the password (and the
 * recovery key) reach the *same* master key minted at Phase 0 — with no enclave
 * involved — which is exactly what a second device does once the account's
 * ciphertext arrives over the relay.
 */
describe("the password unlock door", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  const PASSWORD = "correct horse battery staple";

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
  });

  afterEach(() => {
    cleanup();
  });

  it("unlocks the same MK from the password alone, no enclave", async () => {
    const keyStore = createInMemoryKeyStore();
    const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });
    const { account, recoveryKey } = await enableSync({
      keyStore,
      driver,
      password: PASSWORD,
      platform: "desktop",
    });

    // The account stores only blind material, the device is registered, and the
    // recovery key is a fresh 32-byte secret returned for one-time display.
    expect(account.publicKey).toBeNull();
    expect(recoveryKey).toHaveLength(32);
    const devices = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM device WHERE deleted_at IS NULL",
    );
    expect(devices[0]?.n).toBe(1);

    // Two NEW master-key wrappings exist (password + recovery) on top of the
    // enclave one — three unlock doors to the same MK, re-encrypting nothing.
    const wraps = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE wrapped_kind = 'master' AND deleted_at IS NULL",
    );
    expect(wraps[0]?.n).toBe(3);

    // Second-device simulation: with NO keyStore/enclave access at all, the
    // password reaches the identical MK.
    const unlocked = await unlockWithPassword({ driver, password: PASSWORD });
    expect(unlocked.accountId).toBe(account.id);
    expect(unlocked.masterKey).toEqual(masterKey);
  });

  it("rejects a wrong password before any unwrap", async () => {
    const keyStore = createInMemoryKeyStore();
    await ensureDeviceMasterKey({ keyStore, driver });
    await enableSync({ keyStore, driver, password: PASSWORD });

    await expect(
      unlockWithPassword({ driver, password: "wrong password" }),
    ).rejects.toThrow(/incorrect password/i);
  });

  it("unlocks the same MK from the recovery key", async () => {
    const keyStore = createInMemoryKeyStore();
    const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });
    const { recoveryKey } = await enableSync({
      keyStore,
      driver,
      password: PASSWORD,
    });

    const unlocked = await unlockWithRecoveryKey({ driver, recoveryKey });
    expect(unlocked.masterKey).toEqual(masterKey);

    // A wrong recovery key fails the AEAD unwrap.
    await expect(
      unlockWithRecoveryKey({
        driver,
        recoveryKey: new Uint8Array(32).fill(7),
      }),
    ).rejects.toThrow();
  });

  it("refuses to enable sync twice (the recovery key can't be re-derived)", async () => {
    const keyStore = createInMemoryKeyStore();
    await ensureDeviceMasterKey({ keyStore, driver });
    await enableSync({ keyStore, driver, password: PASSWORD });

    await expect(
      enableSync({ keyStore, driver, password: PASSWORD }),
    ).rejects.toThrow(/already enabled/i);
  });

  it("throws when unlocking a store that never enabled sync", async () => {
    await expect(
      unlockWithPassword({ driver, password: PASSWORD }),
    ).rejects.toThrow(/not enabled/i);
    expect(await createAccountRepo(driver).getSingleton()).toBeUndefined();
  });
});
