import {
  createInMemoryKeyStore,
  deriveKeyMaterial,
  generateKey,
  generateSalt,
  unwrapKey,
  wrapKey,
} from "@leapsake/crypto";
import {
  type SqliteDriver,
  createAccountRepo,
  createKeyWrapRepo,
  runMigrations,
} from "@leapsake/data";
import {
  type AccountBootstrap,
  type AccountBootstrapChannel,
  enableSync,
  reauthenticate,
  unlockWithPassword,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Re-authentication after a remote password reset (`status.md` follow-up): when
 * another device resets the account password, the relay rotates the account's
 * salt + verifier, so this device's stored credential goes stale and its sync
 * 401s. `reauthenticate` re-derives the credential from the re-entered password.
 * This unit-tests the core mechanics against a fake relay channel reflecting the
 * post-reset state (no network); the over-the-wire convergence after a real reset
 * is proven in `apps/server/test/relay.test.ts`.
 */

const USERNAME = "ada";
const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new battery horse staple";
const RELAY_URL = "https://relay.example";

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** The same blind bootstrap surface as the join test: verifies before serving. */
function fakeRelay(bootstrap: AccountBootstrap): AccountBootstrapChannel {
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
      return bootstrap.wrappedMasterKey;
    },
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function freshDevice(): Promise<{
  driver: SqliteDriver;
  keyStore: ReturnType<typeof createInMemoryKeyStore>;
}> {
  const { driver, cleanup } = makeEncryptedTestDriver();
  await runMigrations(driver);
  cleanups.push(cleanup);
  return { driver, keyStore: createInMemoryKeyStore() };
}

describe("reauthenticate — refresh credential after a remote password reset", () => {
  let device: Awaited<ReturnType<typeof freshDevice>>;
  let accountMasterKey: Uint8Array;
  let originalBootstrap: AccountBootstrap;
  let accountId: string;
  // The post-reset relay state: new salt + verifier (NEW_PASSWORD) + wrap(MK, newKEK).
  let newSalt: Uint8Array;
  let newVerifier: Uint8Array;
  let resetBootstrap: AccountBootstrap;

  beforeEach(async () => {
    device = await freshDevice();
    const enabled = await enableSync({
      keyStore: device.keyStore,
      driver: device.driver,
      username: USERNAME,
      password: PASSWORD,
      relayUrl: RELAY_URL,
      platform: "desktop",
    });
    originalBootstrap = enabled.bootstrap;
    // Recover the account MK via the recovery key (without reaching into the
    // enclave) so we can build the post-reset wrap and compare later.
    const recoveryWrap = await createKeyWrapRepo(device.driver).getActive({
      wrappedKind: "master",
      principalKind: "recovery",
    });
    accountMasterKey = unwrapKey(recoveryWrap!.ciphertext, enabled.recoveryKey);
    const account = await createAccountRepo(device.driver).getSingleton();
    accountId = account!.id;

    newSalt = generateSalt();
    const derived = deriveKeyMaterial(NEW_PASSWORD, newSalt);
    newVerifier = derived.authVerifier;
    resetBootstrap = {
      accountId,
      username: USERNAME,
      kdfSalt: newSalt,
      authVerifier: newVerifier,
      wrappedMasterKey: wrapKey(accountMasterKey, derived.kek),
      wrappedMasterKeyRecovery: originalBootstrap.wrappedMasterKeyRecovery,
      recoveryVerifier: originalBootstrap.recoveryVerifier,
    };
  });

  it("rotates the local credential and re-wraps the password door from the new password", async () => {
    await reauthenticate({
      keyStore: device.keyStore,
      driver: device.driver,
      transport: fakeRelay(resetBootstrap),
      password: NEW_PASSWORD,
    });

    // The local account row now carries the rotated salt + verifier.
    const updated = await createAccountRepo(device.driver).getSingleton();
    expect(equal(updated!.kdfSalt, newSalt)).toBe(true);
    expect(equal(updated!.authVerifier, newVerifier)).toBe(true);

    // The password door was refreshed: the new password unlocks the same account
    // MK locally (master key untouched), and exactly one password wrap is active.
    const unlocked = await unlockWithPassword({
      driver: device.driver,
      password: NEW_PASSWORD,
    });
    expect(equal(unlocked.masterKey, accountMasterKey)).toBe(true);
    const passwordWraps = await device.driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE wrapped_kind = 'master' AND principal_kind = 'password' AND deleted_at IS NULL",
    );
    expect(passwordWraps[0]?.n).toBe(1);
  });

  it("rejects a wrong password at the relay verifier, before any local mutation", async () => {
    await expect(
      reauthenticate({
        keyStore: device.keyStore,
        driver: device.driver,
        transport: fakeRelay(resetBootstrap),
        password: "still the wrong password",
      }),
    ).rejects.toThrow(/401/);

    // The account row keeps its original (pre-reset) credential — untouched.
    const after = await createAccountRepo(device.driver).getSingleton();
    expect(equal(after!.kdfSalt, originalBootstrap.kdfSalt)).toBe(true);
    expect(equal(after!.authVerifier, originalBootstrap.authVerifier)).toBe(
      true,
    );
  });

  it("refuses when the relay returns a different account's master key", async () => {
    // A relay whose verifier accepts the new password but whose escrow wraps a
    // *different* MK — the defense-in-depth guard must refuse rather than rewrite
    // the local doors.
    const derived = deriveKeyMaterial(NEW_PASSWORD, newSalt);
    const wrongMkRelay = fakeRelay({
      ...resetBootstrap,
      wrappedMasterKey: wrapKey(generateKey(), derived.kek),
    });
    await expect(
      reauthenticate({
        keyStore: device.keyStore,
        driver: device.driver,
        transport: wrongMkRelay,
        password: NEW_PASSWORD,
      }),
    ).rejects.toThrow(/different account/i);

    const after = await createAccountRepo(device.driver).getSingleton();
    expect(equal(after!.authVerifier, originalBootstrap.authVerifier)).toBe(
      true,
    );
  });
});
