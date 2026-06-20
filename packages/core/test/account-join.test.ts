import { DatabaseSync } from "node:sqlite";
import { createInMemoryKeyStore, unwrapKey } from "@leapsake/crypto";
import {
  type SqliteDriver,
  createAccountRepo,
  createKeyWrapRepo,
  runMigrations,
} from "@leapsake/data";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AccountBootstrap,
  type AccountBootstrapChannel,
  enableSync,
  joinAccount,
} from "../src/key-session.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

/**
 * Multi-device login (custody Phase 2): the one capability that completes
 * Stage-1 sync — a *fresh* device obtaining the account master key by username +
 * password. This unit-tests the core join mechanics against a fake relay channel
 * (no network): MK recovery, enclave adoption, account identity, and the
 * wrong-password rejection. The full over-the-wire convergence is proven in
 * `apps/server/test/relay.test.ts`.
 */

const USERNAME = "Ada"; // mixed-case on purpose: the account stores it normalized
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
      return bootstrap.wrappedMasterKey;
    },
  };
}

async function freshDevice(): Promise<{
  driver: SqliteDriver;
  keyStore: ReturnType<typeof createInMemoryKeyStore>;
  db: DatabaseSync;
}> {
  const db = new DatabaseSync(":memory:");
  const driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  return { driver, keyStore: createInMemoryKeyStore(), db };
}

describe("joinAccount — multi-device login", () => {
  let device1: Awaited<ReturnType<typeof freshDevice>>;
  let bootstrap: AccountBootstrap;
  let accountMasterKey: Uint8Array;

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
    expect(bootstrap.username).toBe("ada"); // trimmed + lowercased
    // The bootstrap's account id is the local account id — the relay namespace
    // the second device will join into.
    const account = await createAccountRepo(device1.driver).getSingleton();
    expect(bootstrap.accountId).toBe(account?.id);
    expect(account?.username).toBe("ada");
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
    expect(account?.username).toBe("ada");
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
