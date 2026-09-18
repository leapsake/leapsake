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
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * `clearLocalAccount` — the **account-creation rollback**: the account identity
 * and the portable doors are removed, but the master key survives in the enclave
 * so data stays readable and an account can be established again.
 *
 * No client calls it today; it is the rollback an account-establishing flow needs
 * when a later step fails, and it must leave the device exactly as it was.
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

  it("clears the account but keeps the enclave master key", async () => {
    await enableSync({ keyStore, driver, password: "old-password" });
    expect((await getSyncStatus({ driver })).hasAccount).toBe(true);

    await clearLocalAccount({ driver });

    // Account is gone; the password + recovery doors are revoked…
    expect((await getSyncStatus({ driver })).hasAccount).toBe(false);
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
  });

  it("is a no-op when no account is set up", async () => {
    await expect(clearLocalAccount({ driver })).resolves.toBeUndefined();
    expect((await getSyncStatus({ driver })).hasAccount).toBe(false);
  });
});
