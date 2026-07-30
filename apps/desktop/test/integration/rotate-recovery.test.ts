import {
  DATABASE_KEY,
  RECOVERY_KEY,
  createInMemoryKeyStore,
  decodeRecoveryPhrase,
  generateKey,
  openDbKeyFromRecovery,
} from "@leapsake/crypto";
import {
  type SqliteDriver,
  createSyncStateRepo,
  runMigrations,
} from "@leapsake/data";
import {
  KEYSTORE_SECRET_IDS,
  adoptRecoveryKey,
  createLocalAccount,
  ensureDeviceMasterKey,
  rotateRecoveryPhraseForAccount,
  unlockWithRecoveryKey,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Custody slice 8 — **replacing the recovery phrase**, in the half that needs no
 * relay: a local-only account, where rotation is complete the moment it returns.
 * The relay half (the escrow, the offline flush, a peer catching up) is proved
 * against a live server in `apps/server/test/relay.test.ts`.
 *
 * The property under test throughout is that a rotation moves the phrase in *all*
 * the places it is fastened at once — the db-key door, the account's `key_wrap`
 * row, and the keychain — because a rotation that moves only some of them is how a
 * user ends up holding words that open nothing.
 */
describe("rotating the recovery phrase", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  const PASSWORD = "correct horse battery staple";

  /** A recovery door writer that records what it was handed. */
  function captureDoor() {
    const written: Uint8Array[] = [];
    return {
      written,
      last: () => written.at(-1),
      write: (door: Uint8Array) => {
        written.push(door);
        return Promise.resolve();
      },
    };
  }

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
  });

  afterEach(() => {
    cleanup();
  });

  /** A device holding a local-only account, as `createLocalAccount` leaves it. */
  async function localAccount() {
    const keyStore = createInMemoryKeyStore();
    const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });
    const { recoveryPhrase, dbKey } = await createLocalAccount({
      keyStore,
      driver,
      username: "ada",
      password: PASSWORD,
    });
    return { keyStore, masterKey, dbKey, phrase: recoveryPhrase };
  }

  it("moves the phrase in all three places, and retires the old one", async () => {
    const { keyStore, masterKey, dbKey, phrase } = await localAccount();
    const door = captureDoor();

    const { recoveryPhrase, escrowPending } =
      await rotateRecoveryPhraseForAccount({
        keyStore,
        driver,
        password: PASSWORD,
        writeRecoveryDoor: door.write,
      });

    // A local-only account has no escrow, so nothing is deferred: the phrase this
    // returns is live everywhere the moment it is shown.
    expect(escrowPending).toBe(false);
    expect(await createSyncStateRepo(driver).getRecoveryEscrowPending()).toBe(
      false,
    );
    expect(recoveryPhrase).not.toBe(phrase);

    const rotated = decodeRecoveryPhrase(recoveryPhrase);

    // 1. The db-key door: the new phrase opens the store's key, the old cannot.
    expect(
      openDbKeyFromRecovery(door.last() ?? new Uint8Array(), rotated),
    ).toEqual(dbKey);
    expect(() =>
      openDbKeyFromRecovery(
        door.last() ?? new Uint8Array(),
        decodeRecoveryPhrase(phrase),
      ),
    ).toThrow();

    // 2. The account door: the new phrase unwraps the same master key, and the old
    //    phrase's wrapping is gone rather than merely shadowed.
    expect(
      (await unlockWithRecoveryKey({ driver, recoveryKey: rotated })).masterKey,
    ).toEqual(masterKey);
    await expect(
      unlockWithRecoveryKey({
        driver,
        recoveryKey: decodeRecoveryPhrase(phrase),
      }),
    ).rejects.toThrow();

    // 3. The keychain, which the boot path re-seals the door from on every launch.
    //    Stale here and the next launch would quietly undo 1 and 2.
    expect(await keyStore.getSecret(RECOVERY_KEY)).toEqual(rotated);
  });

  it("refuses a wrong password without touching anything", async () => {
    const { keyStore, phrase } = await localAccount();
    const before = await keyStore.getSecret(RECOVERY_KEY);
    const door = captureDoor();

    await expect(
      rotateRecoveryPhraseForAccount({
        keyStore,
        driver,
        password: "not the password",
        writeRecoveryDoor: door.write,
      }),
    ).rejects.toThrow(/incorrect password/i);

    // Nothing was minted, nothing was written, and the saved phrase still works.
    expect(door.written).toHaveLength(0);
    expect(await keyStore.getSecret(RECOVERY_KEY)).toEqual(before);
    await expect(
      unlockWithRecoveryKey({
        driver,
        recoveryKey: decodeRecoveryPhrase(phrase),
      }),
    ).resolves.toBeDefined();
  });

  it("refuses on a device with no account", async () => {
    const keyStore = createInMemoryKeyStore();
    await expect(
      rotateRecoveryPhraseForAccount({
        keyStore,
        driver,
        password: PASSWORD,
        writeRecoveryDoor: captureDoor().write,
      }),
    ).rejects.toThrow(/no account/i);
  });

  it("refuses when there is no db-key to seal a door around", async () => {
    // The Open state (§7.2): an account's rows but no at-rest key is not a state
    // the app reaches, and sealing a door around nothing would look like success.
    const { keyStore } = await localAccount();
    await keyStore.deleteSecret(DATABASE_KEY);

    await expect(
      rotateRecoveryPhraseForAccount({
        keyStore,
        driver,
        password: PASSWORD,
        writeRecoveryDoor: captureDoor().write,
      }),
    ).rejects.toThrow(/no database key/i);
  });

  it("wraps the account's master key, not a stray enclave one", async () => {
    // Found by driving it (2026-07-29). A device that lost its OS keychain and
    // came back through a door has a **fresh** enclave master key — the keychain
    // held `device-id` too, so `ensureDeviceMasterKey` finds no wrap row for the
    // new id and mints one. Rotating around *that* key publishes an escrow keyed
    // to a master key the account has never seen, so no device can ever recover
    // from the phrase again: one device's local problem made account-wide.
    const { keyStore, masterKey, phrase } = await localAccount();

    // The state after a keychain wipe + a door unlock: every secret gone except
    // the db-key, which the door just restored.
    for (const id of KEYSTORE_SECRET_IDS) {
      if (id !== DATABASE_KEY) await keyStore.deleteSecret(id);
    }
    const strayMasterKey = (await ensureDeviceMasterKey({ keyStore, driver }))
      .masterKey;
    expect(strayMasterKey).not.toEqual(masterKey);

    const { recoveryPhrase } = await rotateRecoveryPhraseForAccount({
      keyStore,
      driver,
      password: PASSWORD,
      writeRecoveryDoor: captureDoor().write,
    });

    // The new phrase reaches the **account's** master key. Without the fix this
    // yields `strayMasterKey`, and the account's own recovery is quietly dead.
    expect(
      (
        await unlockWithRecoveryKey({
          driver,
          recoveryKey: decodeRecoveryPhrase(recoveryPhrase),
        })
      ).masterKey,
    ).toEqual(masterKey);
    expect(recoveryPhrase).not.toBe(phrase);
  });

  it("seals an adopted key around the adopting device's own db-key", async () => {
    // What a peer catch-up does. Each device holds a *different* db-key, so the
    // rotating device's door bytes are meaningless here — the shared thing is the
    // recovery key, and each device seals its own key under it.
    const { keyStore, masterKey } = await localAccount();
    const peerDbKey = generateKey();
    await keyStore.setSecret(DATABASE_KEY, peerDbKey);
    const adopted = generateKey();
    const door = captureDoor();

    await adoptRecoveryKey({
      keyStore,
      driver,
      recoveryKey: adopted,
      masterKey,
      writeRecoveryDoor: door.write,
    });

    expect(
      openDbKeyFromRecovery(door.last() ?? new Uint8Array(), adopted),
    ).toEqual(peerDbKey);
    expect(await keyStore.getSecret(RECOVERY_KEY)).toEqual(adopted);
    expect(
      (await unlockWithRecoveryKey({ driver, recoveryKey: adopted })).masterKey,
    ).toEqual(masterKey);
  });
});
