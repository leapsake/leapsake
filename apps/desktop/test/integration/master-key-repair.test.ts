import {
  DATABASE_KEY,
  RECOVERY_KEY,
  encodeRecoveryPhrase,
  equalBytes,
  generateSalt,
} from "@leapsake/crypto";
import {
  KEYSTORE_SECRET_IDS,
  adoptAccountMasterKey,
  ensureDeviceMasterKey,
  lockThisDevice,
} from "@leapsake/core";
import {
  createAccountRepo,
  createDeviceRepo,
  createKeyWrapRepo,
  createSyncStateRepo,
} from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BootDevice, makeBootDevice } from "../support/boot-device.js";

/**
 * Custody slice 9 — **re-adopting the account master key after a door unlock.**
 *
 * A door unlock happens precisely when the OS keychain stopped opening the store:
 * a reinstall, a new machine, a changed signing identity. The door recovers the
 * db-key, so the store opens and the user is back in — and that is the whole
 * problem, because the same wipe took `device-id` and `enclave`, so the device used
 * to mint a *brand-new* master key and carry on looking healthy while it seals
 * records no peer can read and discards records it cannot read.
 *
 * The property under test is therefore not "the app opened" — it always did — but
 * "the key it opened with is the account's". Each case that asserts a repair is
 * paired with the state that made it necessary.
 */
describe("re-adopting the account master key", () => {
  const PASSWORD = "correct-horse-battery";
  let device: BootDevice;
  let keyStore: BootDevice["keyStore"];

  beforeEach(() => {
    device = makeBootDevice("mk-repair");
    keyStore = device.keyStore;
  });
  afterEach(() => {
    device.cleanup();
  });

  /**
   * Everything an OS keychain loss takes, which is everything *except* what the
   * door is about to restore. This is what `rm keystore.json` does to a real
   * profile, and it is the only way to reach the state under test.
   */
  async function wipeKeychain(): Promise<void> {
    for (const id of KEYSTORE_SECRET_IDS) await keyStore.deleteSecret(id);
  }

  /** The master key this device's enclave currently vouches for. */
  async function enclaveMasterKey(): Promise<Uint8Array> {
    const { driver, keySession } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    await driver.close?.();
    if (keySession === undefined) throw new Error("expected a key session");
    return keySession.masterKey;
  }

  it("brings back the account's master key after a keychain wipe, via the password", async () => {
    await device.deviceWithAccount(PASSWORD);
    const before = await enclaveMasterKey();

    await wipeKeychain();
    const { driver, keySession, status } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });

    expect(status).toBe("adopted");
    expect(equalBytes(keySession!.masterKey, before)).toBe(true);

    // Exactly one live enclave door for the device that now exists. The pre-wipe
    // device's row survives beside it and is deliberately left: it is keyed to a
    // device id nothing will ever present again, and its enclave secret died with
    // the keychain, so it is unopenable and unmatchable rather than merely unused.
    const mine = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE principal_kind = 'enclave' " +
        "AND principal_ref = ? AND deleted_at IS NULL",
      [keySession!.deviceId],
    );
    expect(mine[0]?.n).toBe(1);

    // And the repaired device is registered, so it is a device the account knows.
    expect(
      await createDeviceRepo(driver).get(keySession!.deviceId),
    ).toBeDefined();
    await driver.close?.();
  });

  it("does the same through the recovery phrase", async () => {
    await device.deviceWithAccount(PASSWORD);
    const before = await enclaveMasterKey();
    const recoveryKey = await keyStore.getSecret(RECOVERY_KEY);
    const phrase = encodeRecoveryPhrase(recoveryKey!);

    await wipeKeychain();
    const { driver, keySession, status } = await device.bootAndRepair({
      door: "phrase",
      secret: phrase,
    });

    expect(status).toBe("adopted");
    expect(equalBytes(keySession!.masterKey, before)).toBe(true);
    await driver.close?.();
  });

  it("without the repair, the same boot invents a different key", async () => {
    // The bug itself, and the reason the two cases above mean anything. `bootWith`
    // is the old sequence: unlock the door, open the store, ask for a key session.
    // Slice 9's source guard now catches it at exactly that last step.
    await device.deviceWithAccount(PASSWORD);
    await enclaveMasterKey();

    await wipeKeychain();
    const driver = await device.bootWith({
      door: "password",
      secret: PASSWORD,
    });

    await expect(ensureDeviceMasterKey({ keyStore, driver })).rejects.toThrow(
      /re-adopted from an unlock door/i,
    );
    await driver.close?.();
  });

  it("leaves an ordinary sign-out alone", async () => {
    // The common case by far: signing out keeps `device-id` and `enclave`, so the
    // gate is re-entered on every re-login with nothing to repair. A repair that
    // fired here would churn a fresh `key_wrap` row per sign-in.
    await device.deviceWithAccount(PASSWORD);
    const first = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    const rowsBefore = await first.driver.all<{ id: string }>(
      "SELECT id FROM key_wrap WHERE principal_kind = 'enclave' AND deleted_at IS NULL",
    );
    await first.driver.close?.();

    await lockThisDevice({ keyStore });
    const after = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });

    expect(after.status).toBe("unchanged");
    expect(after.keySession!.deviceId).toBe(first.keySession!.deviceId);
    const rowsAfter = await after.driver.all<{ id: string }>(
      "SELECT id FROM key_wrap WHERE principal_kind = 'enclave' AND deleted_at IS NULL",
    );
    expect(rowsAfter).toEqual(rowsBefore);
    await after.driver.close?.();
  });

  it("is idempotent — a second door unlock repairs nothing", async () => {
    await device.deviceWithAccount(PASSWORD);
    await enclaveMasterKey();
    await wipeKeychain();

    const first = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    expect(first.status).toBe("adopted");
    await first.driver.close?.();

    await lockThisDevice({ keyStore });
    const second = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    expect(second.status).toBe("unchanged");
    await second.driver.close?.();
  });

  it("rewinds both sync watermarks when it really repaired something", async () => {
    // A stray key does not just stop syncing: it pushes records peers cannot open
    // and skips theirs, and the engine advances past both rather than stalling. So
    // a repair has to re-offer everything in both directions.
    await device.deviceWithAccount(PASSWORD);
    await enclaveMasterKey();

    const primed = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    const syncState = createSyncStateRepo(primed.driver);
    await syncState.setPushHwm(12_345);
    await syncState.setPullCursor(678);
    await primed.driver.close?.();

    await wipeKeychain();
    const { driver, status } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });

    expect(status).toBe("adopted");
    const repaired = createSyncStateRepo(driver);
    expect(await repaired.getPushHwm()).toBe(0);
    expect(await repaired.getPullCursor()).toBe(0);
    await driver.close?.();
  });

  it("refuses a password door that has drifted from its account", async () => {
    // A sidecar left behind by a crash mid password-change: it still opens the
    // db-key, so the store opens, but its KEK cannot unwrap the master key. Better
    // to say so than to fail one line later inside an AEAD.
    await device.deviceWithAccount(PASSWORD);
    const { driver } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    await createAccountRepo(driver).updateCredentials({
      kdfSalt: generateSalt(),
      authVerifier: generateSalt(),
    });

    await expect(
      adoptAccountMasterKey({
        keyStore,
        driver,
        door: {
          kind: "password",
          kek: new Uint8Array(32),
          authVerifier: new Uint8Array(32),
        },
      }),
    ).rejects.toThrow(/out of step with its account/i);
    await driver.close?.();
  });

  it("refuses when there is no account to adopt a key for", async () => {
    const { driver } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    await expect(
      adoptAccountMasterKey({
        keyStore,
        driver,
        door: { kind: "recovery", recoveryKey: new Uint8Array(32) },
      }),
    ).rejects.toThrow(/no account on this device/i);
    await driver.close?.();
  });

  it("refuses when the door it was handed has no wrap row", async () => {
    await device.deviceWithAccount(PASSWORD);
    const { driver } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    const keyWrapRepo = createKeyWrapRepo(driver);
    const recovery = await keyWrapRepo.getActive({
      wrappedKind: "master",
      principalKind: "recovery",
    });
    await keyWrapRepo.revoke(recovery!.id);

    await expect(
      adoptAccountMasterKey({
        keyStore,
        driver,
        door: { kind: "recovery", recoveryKey: new Uint8Array(32) },
      }),
    ).rejects.toThrow(/no recovery unlock door/i);
    await driver.close?.();
  });

  it("still keeps the db-key in the keychain, so the gate is not re-raised", async () => {
    // A repair that forgot this would leave the user typing their password on
    // every launch forever — the door restores the db-key, and it must stick.
    await device.deviceWithAccount(PASSWORD);
    await enclaveMasterKey();
    await wipeKeychain();

    const { driver } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    await driver.close?.();
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeDefined();

    const relaunch = await device.bootAndRepair({
      door: "password",
      secret: "this must never be asked for",
    });
    expect(relaunch.status).toBeUndefined();
    await relaunch.driver.close?.();
  });
});
