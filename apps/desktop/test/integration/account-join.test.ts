import {
  createInMemoryKeyStore,
  deriveRecoveryVerifier,
  unwrapKey,
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
  joinAccount,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Multi-device login (custody Phase 2): the one capability that completes
 * Stage-1 sync — a *fresh* device obtaining the account master key by username +
 * password. This unit-tests the core join mechanics against a fake relay channel
 * (no network): MK recovery, enclave adoption, account identity, and the
 * wrong-password rejection. The full over-the-wire convergence is proven in
 * `apps/server/test/relay.test.ts`.
 */

const USERNAME = "Mary"; // mixed-case on purpose: the account stores it normalized
const PASSWORD = "correct horse battery staple";
const RELAY_URL = "https://relay.example";

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * A blind relay's bootstrap surface, in memory. It holds exactly what the real
 * relay does — the public salt, the auth verifier, and the opaque wrap(MK, KEK) —
 * and authenticates `fetchBootstrap` by the verifier, so a wrong password is
 * rejected here (a 401 analogue) before any unwrap, just like the wire.
 */
function fakeRelay(bootstrap: AccountBootstrap): AccountBootstrapChannel {
  return {
    async lookup(username) {
      if (username !== bootstrap.username) throw new Error("404 not found");
      return {
        accountId: bootstrap.accountId,
        kdfSalt: bootstrap.kdfSalt,
      };
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

describe("joinAccount — multi-device login", () => {
  let device1: Awaited<ReturnType<typeof freshDevice>>;
  let bootstrap: AccountBootstrap;
  let accountMasterKey: Uint8Array;
  let accountRecoveryKey: Uint8Array;

  beforeEach(async () => {
    device1 = await freshDevice();
    const enabled = await enableSync({
      keyStore: device1.keyStore,
      driver: device1.driver,
      username: USERNAME,
      password: PASSWORD,
      relayUrl: RELAY_URL,
      platform: "desktop",
    });
    bootstrap = enabled.bootstrap;
    accountRecoveryKey = enabled.recoveryKey;
    // The MK the account is built around, unwrapped via the recovery key so we
    // can compare device 2 to it without reaching into device 1's enclave.
    const recoveryWrap = await createKeyWrapRepo(device1.driver).getActive({
      wrappedKind: "master",
      principalKind: "recovery",
    });
    expect(recoveryWrap).toBeDefined();
    accountMasterKey = unwrapKey(recoveryWrap!.ciphertext, enabled.recoveryKey);
  });

  it("normalizes and persists the bootstrap for relay registration", async () => {
    expect(bootstrap.username).toBe("mary"); // trimmed + lowercased
    // The bootstrap's account id is the local account id — the relay namespace
    // the second device will join into.
    const account = await createAccountRepo(device1.driver).getSingleton();
    expect(bootstrap.accountId).toBe(account?.id);
    expect(account?.username).toBe("mary");
    expect(bootstrap.wrappedMasterKey.length).toBeGreaterThan(0);
  });

  it("recovers the account master key and adopts it under the device enclave", async () => {
    const device2 = await freshDevice();
    const session = await joinAccount({
      keyStore: device2.keyStore,
      driver: device2.driver,
      transport: fakeRelay(bootstrap),
      relayUrl: RELAY_URL,
      username: USERNAME,
      password: PASSWORD,
      platform: "mobile",
    });

    // Device 2 ends up holding the *account* master key.
    expect(equal(session.masterKey, accountMasterKey)).toBe(true);

    // The local account row mirrors the relay namespace + login coordinates.
    const account = await createAccountRepo(device2.driver).getSingleton();
    expect(account?.id).toBe(bootstrap.accountId);
    expect(account?.username).toBe("mary");
    expect(account?.relayUrl).toBe(RELAY_URL);

    // Enclave adoption replaced the throwaway first-launch wrap: exactly one
    // active master/enclave wrap, and it unwraps to the account MK — so a later
    // launch recovers the account MK from the enclave alone, no re-login.
    const enclaveWraps = await device2.driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE wrapped_kind = 'master' AND principal_kind = 'enclave' AND deleted_at IS NULL",
    );
    expect(enclaveWraps[0]?.n).toBe(1);

    const adopted = await createKeyWrapRepo(device2.driver).getActive({
      wrappedKind: "master",
      principalKind: "enclave",
      principalRef: session.deviceId,
    });
    const enclaveKey = await device2.keyStore.getSecret("enclave");
    expect(
      equal(unwrapKey(adopted!.ciphertext, enclaveKey!), accountMasterKey),
    ).toBe(true);

    // The device is registered on the account.
    const devices = await device2.driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM device WHERE deleted_at IS NULL",
    );
    expect(devices[0]?.n).toBe(1);
  });

  it("adopts the account recovery key so device 2 reveals the account phrase", async () => {
    const device2 = await freshDevice();
    // Capture device 2's throwaway first-launch recovery key: the bug was that
    // joining kept *this* key, so Settings showed a phrase that recovers nothing.
    const preJoinRecoveryKey = await device2.keyStore.getSecret("recovery-key");

    await joinAccount({
      keyStore: device2.keyStore,
      driver: device2.driver,
      transport: fakeRelay(bootstrap),
      relayUrl: RELAY_URL,
      username: USERNAME,
      password: PASSWORD,
      platform: "mobile",
    });

    // Device 2 now holds the *account* recovery key — the same one device 1 shows,
    // whose verifier matches the relay escrow (so recovery on a third device works).
    const device2RecoveryKey = await device2.keyStore.getSecret("recovery-key");
    expect(device2RecoveryKey).toBeDefined();
    expect(equal(device2RecoveryKey!, accountRecoveryKey)).toBe(true);
    if (preJoinRecoveryKey !== undefined) {
      // If a throwaway existed, it was genuinely replaced (the bug, made concrete).
      expect(equal(device2RecoveryKey!, preJoinRecoveryKey)).toBe(false);
    }
    expect(
      equal(
        deriveRecoveryVerifier(device2RecoveryKey!),
        bootstrap.recoveryVerifier,
      ),
    ).toBe(true);

    // And the local `recovery` door this flow used to lack now exists and unwraps
    // the account MK under the account recovery key.
    const recoveryDoor = await createKeyWrapRepo(device2.driver).getActive({
      wrappedKind: "master",
      principalKind: "recovery",
    });
    expect(recoveryDoor).toBeDefined();
    expect(
      equal(
        unwrapKey(recoveryDoor!.ciphertext, accountRecoveryKey),
        accountMasterKey,
      ),
    ).toBe(true);
  });

  it("back-compat: joins a pre-unification relay and keeps its device-local phrase", async () => {
    const device2 = await freshDevice();
    // A pre-change relay omits wrappedRecoveryKey from bootstrap.
    const legacyRelay: AccountBootstrapChannel = {
      lookup: (u) => fakeRelay(bootstrap).lookup(u),
      async fetchBootstrap(creds) {
        const { wrappedMasterKey } =
          await fakeRelay(bootstrap).fetchBootstrap(creds);
        return { wrappedMasterKey };
      },
    };
    const preJoinRecoveryKey = await device2.keyStore.getSecret("recovery-key");

    const session = await joinAccount({
      keyStore: device2.keyStore,
      driver: device2.driver,
      transport: legacyRelay,
      relayUrl: RELAY_URL,
      username: USERNAME,
      password: PASSWORD,
      platform: "mobile",
    });

    // No throw, MK recovered — and no recovery adoption happened, so the device
    // keeps whatever recovery key it already had (unchanged) and lays no door.
    expect(equal(session.masterKey, accountMasterKey)).toBe(true);
    const after = await device2.keyStore.getSecret("recovery-key");
    if (preJoinRecoveryKey === undefined) {
      expect(after).toBeUndefined();
    } else {
      expect(equal(after!, preJoinRecoveryKey)).toBe(true);
    }
    const recoveryDoor = await createKeyWrapRepo(device2.driver).getActive({
      wrappedKind: "master",
      principalKind: "recovery",
    });
    expect(recoveryDoor).toBeUndefined();
  });

  it("rejects a wrong password at the relay verifier, before any unwrap", async () => {
    const device2 = await freshDevice();
    await expect(
      joinAccount({
        keyStore: device2.keyStore,
        driver: device2.driver,
        transport: fakeRelay(bootstrap),
        relayUrl: RELAY_URL,
        username: USERNAME,
        password: "wrong password",
      }),
    ).rejects.toThrow(/401/);

    // Nothing was written — no account, no adopted key.
    expect(
      await createAccountRepo(device2.driver).getSingleton(),
    ).toBeUndefined();
  });

  it("refuses to join when this device is already part of an account", async () => {
    await expect(
      joinAccount({
        keyStore: device1.keyStore,
        driver: device1.driver,
        transport: fakeRelay(bootstrap),
        relayUrl: RELAY_URL,
        username: USERNAME,
        password: PASSWORD,
      }),
    ).rejects.toThrow(/already part of an account/i);
  });
});
