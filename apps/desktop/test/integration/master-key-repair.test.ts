import {
  DATABASE_KEY,
  RECOVERY_KEY,
  encodeRecoveryPhrase,
  equalBytes,
  generateSalt,
} from "@leapsake/crypto";
import {
  type BootKeySession,
  KEYSTORE_SECRET_IDS,
  type KeySession,
  type SqliteDriver,
  adoptAccountMasterKey,
  ensureDeviceMasterKey,
  lockThisDevice,
} from "@leapsake/core";
import {
  createAccountRepo,
  createDeviceRepo,
  createKeyWrapRepo,
  createPeopleRepo,
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

  /**
   * The key session a boot produced, insisting there is one. Every case here runs on
   * an Authenticated store, so a boot that came back Degraded — or with no session — is a
   * failure of the case rather than something to branch on.
   */
  function expectKeySession(established: BootKeySession): KeySession {
    if (established.state !== "ok" || established.keySession === undefined) {
      throw new Error(
        `expected a key session, got ${JSON.stringify(established)}`,
      );
    }
    return established.keySession;
  }

  /** The master key this device's enclave currently vouches for. */
  async function enclaveMasterKey(): Promise<Uint8Array> {
    const { driver, established } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    await driver.close?.();
    if (established.state !== "ok" || established.keySession === undefined) {
      throw new Error("expected a key session");
    }
    return established.keySession.masterKey;
  }

  it("brings back the account's master key after a keychain wipe, via the password", async () => {
    await device.deviceWithAccount(PASSWORD);
    const before = await enclaveMasterKey();

    await wipeKeychain();
    const { driver, established } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });

    expect(established).toMatchObject({ state: "ok", repair: "adopted" });
    const keySession = expectKeySession(established);
    expect(equalBytes(keySession.masterKey, before)).toBe(true);

    // Exactly one live enclave door for the device that now exists. The pre-wipe
    // device's row survives beside it and is deliberately left: it is keyed to a
    // device id nothing will ever present again, and its enclave secret died with
    // the keychain, so it is unopenable and unmatchable rather than merely unused.
    const mine = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE principal_kind = 'enclave' " +
        "AND principal_ref = ? AND deleted_at IS NULL",
      [keySession.deviceId],
    );
    expect(mine[0]?.n).toBe(1);

    // And the repaired device is registered, so it is a device the account knows.
    expect(
      await createDeviceRepo(driver).get(keySession.deviceId),
    ).toBeDefined();
    await driver.close?.();
  });

  it("does the same through the recovery phrase", async () => {
    await device.deviceWithAccount(PASSWORD);
    const before = await enclaveMasterKey();
    const recoveryKey = await keyStore.getSecret(RECOVERY_KEY);
    const phrase = encodeRecoveryPhrase(recoveryKey!);

    await wipeKeychain();
    const { driver, established } = await device.bootAndRepair({
      door: "phrase",
      secret: phrase,
    });

    expect(established).toMatchObject({ state: "ok", repair: "adopted" });
    expect(equalBytes(expectKeySession(established).masterKey, before)).toBe(
      true,
    );
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

    expect(after.established).toMatchObject({ repair: "unchanged" });
    expect(expectKeySession(after.established).deviceId).toBe(
      expectKeySession(first.established).deviceId,
    );
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
    expect(first.established).toMatchObject({ repair: "adopted" });
    await first.driver.close?.();

    await lockThisDevice({ keyStore });
    const second = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });
    expect(second.established).toMatchObject({ repair: "unchanged" });
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
    const { driver, established } = await device.bootAndRepair({
      door: "password",
      secret: PASSWORD,
    });

    expect(established).toMatchObject({ repair: "adopted" });
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
    expect(relaunch.established).toMatchObject({ state: "ok" });
    expect(
      (relaunch.established as { repair?: string }).repair,
    ).toBeUndefined();
    await relaunch.driver.close?.();
  });

  /**
   * Custody slice 10 — **the Degraded state.** Slice 9 shipped strict: a repair had
   * to succeed or the app refused to open. These cases pin what replaced that, and
   * the two things that must *not* change with it — no stray key is ever minted, and
   * a device that cannot vouch for the account's key does not sync.
   */
  describe("when the repair cannot succeed", () => {
    /** How many enclave doors the account currently has, across all device ids. */
    async function activeEnclaveWraps(driver: SqliteDriver): Promise<number> {
      const rows = await driver.all<{ n: number }>(
        "SELECT COUNT(*) AS n FROM key_wrap WHERE principal_kind = 'enclave' " +
          "AND wrapped_kind = 'master' AND deleted_at IS NULL",
      );
      return rows[0]?.n ?? 0;
    }

    /**
     * A password door left behind by a crash mid password-change: it still opens the
     * db-key (the sidecar is untouched), so the gate lets the user in, but the
     * verifier it derives no longer matches the account row — so the repair cannot
     * trust it and refuses. The realistic route into Degraded.
     */
    async function deviceWithDriftedPasswordDoor(): Promise<void> {
      await device.deviceWithAccount(PASSWORD);
      await enclaveMasterKey();
      const { driver } = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });
      await createAccountRepo(driver).updateCredentials({
        kdfSalt: generateSalt(),
        authVerifier: generateSalt(),
      });
      await driver.close?.();
      await wipeKeychain();
    }

    it("opens the store anyway, and says why it cannot sync", async () => {
      await deviceWithDriftedPasswordDoor();

      const { driver, established } = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });

      // Degraded, not thrown: the app is usable and the person is told what is
      // wrong, instead of meeting a window that never renders.
      expect(established.state).toBe("degraded");
      expect(established).toMatchObject({
        message: expect.stringMatching(/out of step with its account/i),
      });
      // Their data is right there — which is the whole argument for opening.
      const people = await createPeopleRepo(driver).list();
      expect(people.map((p) => p.firstName)).toContain("Mary");
      await driver.close?.();
    });

    it("mints nothing while degraded, so no stray key can exist", async () => {
      // The invariant slice 9 exists for. Softening the *posture* must not soften
      // this: a device holding a key the account never saw seals records no peer can
      // open and discards theirs, in silence.
      await deviceWithDriftedPasswordDoor();

      const { driver, established } = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });

      expect(established.state).toBe("degraded");
      // Only the pre-wipe device's door, which is unopenable and unmatchable. A
      // second row here would mean something minted a key for the new device id.
      expect(await activeEnclaveWraps(driver)).toBe(1);
      await driver.close?.();
    });

    it("has no key session, which is what keeps sync off", async () => {
      // Every sync path on both clients gates on the key session — the scheduler
      // thunk, and the launch-time escrow catch-up that would otherwise publish this
      // device's key to the relay and make one device's problem account-wide.
      await deviceWithDriftedPasswordDoor();

      const { driver, established } = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });

      expect(established.state).toBe("degraded");
      expect(established).not.toHaveProperty("keySession");
      await driver.close?.();
    });

    it("leaves the repair flagged, so the eventual repair still rewinds", async () => {
      await deviceWithDriftedPasswordDoor();

      const { driver, established } = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });

      expect(established.state).toBe("degraded");
      expect(
        await createSyncStateRepo(driver).getMasterKeyRepairPending(),
      ).toBe(true);
      await driver.close?.();
    });

    it("is repaired by the other door, which clears the flag and rewinds", async () => {
      // The way out, and the reason the banner's copy sends the user to the door
      // they did not use: the phrase door derives from the recovery key, not the
      // password salt, so a drifted password door leaves it working.
      await device.deviceWithAccount(PASSWORD);
      const before = await enclaveMasterKey();
      const phrase = encodeRecoveryPhrase(
        (await keyStore.getSecret(RECOVERY_KEY))!,
      );

      const primed = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });
      await createAccountRepo(primed.driver).updateCredentials({
        kdfSalt: generateSalt(),
        authVerifier: generateSalt(),
      });
      const primedState = createSyncStateRepo(primed.driver);
      await primedState.setPushHwm(12_345);
      await primedState.setPullCursor(678);
      await primed.driver.close?.();
      await wipeKeychain();

      const degraded = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });
      expect(degraded.established.state).toBe("degraded");
      await degraded.driver.close?.();

      // Sign out is what the banner's CTA does; the gate then offers both doors.
      await lockThisDevice({ keyStore });
      const { driver, established } = await device.bootAndRepair({
        door: "phrase",
        secret: phrase,
      });

      expect(established).toMatchObject({ state: "ok", repair: "adopted" });
      expect(equalBytes(expectKeySession(established).masterKey, before)).toBe(
        true,
      );
      const syncState = createSyncStateRepo(driver);
      expect(await syncState.getMasterKeyRepairPending()).toBe(false);
      // The rewind the flag was holding open: this device re-pushes and re-pulls
      // everything once, including whatever it wrote while degraded.
      expect(await syncState.getPushHwm()).toBe(0);
      expect(await syncState.getPullCursor()).toBe(0);
      await driver.close?.();
    });

    it("finishes a repair that an earlier launch died half-way through", async () => {
      // Adopting the key and rewinding the watermarks are two durable writes. A
      // crash between them used to leave a device with the *right* key and a holed
      // history — the exact damage the repair exists to undo. The flag spans the
      // pair, so the next launch completes it even with no door in sight.
      await device.deviceWithAccount(PASSWORD);
      await enclaveMasterKey();

      const primed = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });
      const primedState = createSyncStateRepo(primed.driver);
      await primedState.setPushHwm(12_345);
      await primedState.setPullCursor(678);
      await primedState.setMasterKeyRepairPending(true);
      await primed.driver.close?.();

      const { driver, established } = await device.bootAndRepair({
        door: "password",
        secret: "this must never be asked for",
      });

      expect(established.state).toBe("ok");
      const syncState = createSyncStateRepo(driver);
      expect(await syncState.getPushHwm()).toBe(0);
      expect(await syncState.getPullCursor()).toBe(0);
      expect(await syncState.getMasterKeyRepairPending()).toBe(false);
      await driver.close?.();
    });

    it("does not rewind an ordinary sign-out", async () => {
      // The negative of the two cases above, and the reason the flag is written
      // rather than assumed: a routine sign-out returns `"unchanged"`, and charging
      // it a full re-push and re-pull of the account would be a real cost paid
      // often, for nothing.
      await device.deviceWithAccount(PASSWORD);
      const primed = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });
      const primedState = createSyncStateRepo(primed.driver);
      await primedState.setPushHwm(12_345);
      await primedState.setPullCursor(678);
      await primed.driver.close?.();

      await lockThisDevice({ keyStore });
      const { driver, established } = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });

      expect(established).toMatchObject({ state: "ok", repair: "unchanged" });
      const syncState = createSyncStateRepo(driver);
      expect(await syncState.getPushHwm()).toBe(12_345);
      expect(await syncState.getPullCursor()).toBe(678);
      expect(await syncState.getMasterKeyRepairPending()).toBe(false);
      await driver.close?.();
    });

    it("degrades when there is no door to repair from either", async () => {
      // The case no door can reach: an account, a db-key that still opens the store,
      // but no enclave wrap for this device — so nothing raises the gate and
      // `ensureDeviceMasterKey` correctly refuses to mint. Before slice 10 that threw
      // out of the boot path; now it is the same Degraded state, reached without a
      // door and resolvable with one.
      await device.deviceWithAccount(PASSWORD);
      await enclaveMasterKey();

      const primed = await device.bootAndRepair({
        door: "password",
        secret: PASSWORD,
      });
      const keyWrapRepo = createKeyWrapRepo(primed.driver);
      const enclave = await keyWrapRepo.getActive({
        wrappedKind: "master",
        principalKind: "enclave",
        principalRef: expectKeySession(primed.established).deviceId,
      });
      await keyWrapRepo.revoke(enclave!.id);
      await primed.driver.close?.();

      const { driver, established } = await device.bootAndRepair({
        door: "password",
        secret: "this must never be asked for",
      });

      expect(established.state).toBe("degraded");
      expect(established).toMatchObject({
        message: expect.stringMatching(/re-adopted from an unlock door/i),
      });
      expect(
        await createSyncStateRepo(driver).getMasterKeyRepairPending(),
      ).toBe(true);
      await driver.close?.();
    });
  });
});
