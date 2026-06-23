import { createInMemoryKeyStore, equalBytes } from "@leapsake/crypto";
import {
  type SqliteDriver,
  createKeyWrapRepo,
  runMigrations,
} from "@leapsake/data";
import {
  clearLocalAccount,
  enableSync,
  ensureDeviceMasterKey,
  getSyncStatus,
  unlockWithPassword,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Disconnecting an account from a device (clearLocalAccount): the account
 * identity and the portable doors are removed, but the master key survives in
 * the enclave so data stays readable and sync can be set up again — the recovery
 * path for a pre-relay account that was enabled without a username/relay.
 */
describe("clearLocalAccount", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  let keyStore: ReturnType<typeof createInMemoryKeyStore>;
  let masterKey: Uint8Array;

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
    keyStore = createInMemoryKeyStore();
    // The stable enclave master key, captured before any account exists.
    masterKey = (await ensureDeviceMasterKey({ keyStore, driver })).masterKey;
  });

  afterEach(() => {
    cleanup();
  });

  it("clears the account but keeps the enclave master key, and allows re-enabling", async () => {
    await enableSync({ keyStore, driver, password: "old-password" });
    expect((await getSyncStatus({ driver })).enabled).toBe(true);

    await clearLocalAccount({ driver });

    // Account is gone; the password + recovery doors are revoked…
    expect((await getSyncStatus({ driver })).enabled).toBe(false);
    const keyWrapRepo = createKeyWrapRepo(driver);
    for (const door of ["password", "recovery"] as const) {
      expect(
        await keyWrapRepo.getActive({
          wrappedKind: "master",
          principalKind: door,
        }),
      ).toBeUndefined();
    }
    // …but the same master key still unlocks from the enclave (data is safe).
    expect(
      equalBytes(
        (await ensureDeviceMasterKey({ keyStore, driver })).masterKey,
        masterKey,
      ),
    ).toBe(true);

    // Re-enabling with the coordinates the first account lacked succeeds (no
    // unique-index collision) and binds a new password door to the same MK.
    await enableSync({
      keyStore,
      driver,
      password: "new-password",
      username: "ada",
      relayUrl: "https://relay.example",
    });
    const status = await getSyncStatus({ driver });
    expect(status.enabled).toBe(true);
    expect(status.username).toBe("ada");
    const unlocked = await unlockWithPassword({
      driver,
      password: "new-password",
    });
    expect(equalBytes(unlocked.masterKey, masterKey)).toBe(true);
  });

  it("is a no-op when no account is set up", async () => {
    await expect(clearLocalAccount({ driver })).resolves.toBeUndefined();
    expect((await getSyncStatus({ driver })).enabled).toBe(false);
  });
});
