import {
  ALG,
  DATABASE_KEY,
  RECOVERY_KEY,
  type KeyStore,
  deriveKeyMaterial,
  encodeRecoveryPhrase,
  equalBytes,
  generateRecoveryKey,
  readRecoveryKey,
  sealDbKeyForRecovery,
  unwrapKey,
  wrapKey,
} from "@leapsake/crypto";
import {
  type SqliteDriver,
  createAccountRepo,
  createKeyWrapRepo,
} from "@leapsake/data";

/**
 * **Custody slice 8 — replacing the recovery phrase** (`model.md` §6). The phrase
 * is shown once at account creation and never again; this is the only later route
 * to a new one, and it is **compromise response, not recovery**: it needs the
 * password, and the phrase exists for when the password is gone. Anyone reaching
 * for this because they *lost* their password is in the wrong place — the copy at
 * every call site has to say so.
 *
 * Persisting the new door is the client's job ({@link RecoveryDoorWriter}), the
 * way {@link sealPasswordDoor} leaves the password sidecar to its caller: on
 * desktop it is a file beside the store, on mobile a row in that account's
 * `doors.db`.
 */

/**
 * Persist this device's at-rest **recovery door** — `seal(db-key, recoveryKey)`.
 * The platform half of {@link adoptRecoveryKey}, injected for the same reason
 * `PasswordDoorWriter` is: where the bytes land is the one part of custody that
 * genuinely differs per client.
 */
export type RecoveryDoorWriter = (door: Uint8Array) => Promise<void> | void;

/**
 * Make `recoveryKey` this device's recovery key, in all three places it is
 * fastened. Shared by the two paths that change it — a {@link
 * rotateRecoveryPhrase} on this device, and a peer adopting a rotation another
 * device performed — because doing only some of them is the failure this whole
 * slice exists to avoid:
 *
 * 1. the **db-key door**, so the phrase reopens the file after a keychain wipe;
 * 2. the `key_wrap(master, recovery)` row, so the phrase unwraps the *account*
 *    master key (`unlockWithRecoveryKey`);
 * 3. the keychain copy, which the boot path re-seals the door from on every
 *    launch (`open.ts`, `core-context.tsx`) — leave it stale and the next launch
 *    quietly undoes steps 1 and 2.
 *
 * The door is written first and the keychain last. A crash between them leaves a
 * door the *new* phrase opens and a keychain holding the old key, which the next
 * boot resolves by re-sealing under the old one — back to the starting state,
 * with the user's saved phrase still working. The reverse order strands a keychain
 * key no door on disk matches.
 */
export async function adoptRecoveryKey(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  recoveryKey: Uint8Array;
  masterKey: Uint8Array;
  writeRecoveryDoor: RecoveryDoorWriter;
}): Promise<void> {
  const { keyStore, driver, recoveryKey, masterKey, writeRecoveryDoor } = opts;

  const dbKey = await keyStore.getSecret(DATABASE_KEY);
  if (dbKey === undefined) {
    // An Open store has no db-key by design (§7.2) and no phrase to rotate; a
    // signed-out one is not running this at all.
    throw new Error("This device has no database key to seal a new door for.");
  }
  await writeRecoveryDoor(sealDbKeyForRecovery(dbKey, recoveryKey));

  await driver.transaction(async () => {
    const keyWrapRepo = createKeyWrapRepo(driver);
    const old = await keyWrapRepo.getActive({
      wrappedKind: "master",
      principalKind: "recovery",
    });
    if (old !== undefined) await keyWrapRepo.revoke(old.id);
    await keyWrapRepo.add({
      wrappedKind: "master",
      principalKind: "recovery",
      ciphertext: wrapKey(masterKey, recoveryKey),
      alg: ALG,
    });
  });

  await keyStore.setSecret(RECOVERY_KEY, recoveryKey);
}

/**
 * Mint a new recovery key, retire the old one on this device, and return the
 * phrase to show **once**.
 *
 * The gate is the account password, checked **locally** — the same
 * derive-and-compare `unlockWithPassword` does, against the account row's own
 * verifier. Local on purpose: rotation must work for an account that never had a
 * relay, and for a relay-bound one whose device is currently offline. The one
 * consequence worth knowing is that a device whose credential is *stale* (the
 * password was reset elsewhere; the 401 `reauthenticate` answers) will refuse the
 * user's current password here. That is correct — this device has not yet
 * re-authenticated, and until it does the password it knows is the old one.
 *
 * It deliberately does **not** touch the relay. The escrow the relay holds is
 * what a *fresh* device recovers from, and updating it needs the network, which
 * would make rotation impossible offline; `flushPendingRecoveryEscrow` in
 * `@leapsake/core` carries it there on the next sync instead. Until that lands the
 * old phrase is still what recovers the account, so a caller that cannot flush
 * immediately **must** say so.
 *
 * ### The master key comes from the password door, never the enclave
 *
 * Load-bearing, and found by driving it. A device that lost its OS keychain and
 * came back in through a door has a **fresh** enclave master key: the keychain
 * held `device-id` too, so `ensureDeviceMasterKey` finds no wrap row for the new
 * id and mints one (the same hazard sign-out avoids by not clearing those two
 * ids). Wrapping the new phrase around *that* key would publish an escrow keyed
 * to a master key the account has never seen — turning one device's local problem
 * into an account-wide one, where no device can recover from the phrase at all.
 *
 * The password door is authoritative by construction: `wrap(MK, KEK)` holds the
 * account's master key, and the KEK was just derived to check the password, so
 * this costs one AEAD open and no second Argon2 pass. It also means a rotation
 * mints no master key as a side effect.
 *
 * Returns that master key alongside the phrase because the caller (the core
 * wrapper) needs it to compute the escrow, and re-reading it would repeat the work.
 */
export async function rotateRecoveryPhrase(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
  writeRecoveryDoor: RecoveryDoorWriter;
}): Promise<{
  recoveryPhrase: string;
  recoveryKey: Uint8Array;
  masterKey: Uint8Array;
}> {
  const { keyStore, driver, password, writeRecoveryDoor } = opts;

  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined) {
    throw new Error(
      "There is no account on this device to rotate a phrase for.",
    );
  }
  const { kek, authVerifier } = deriveKeyMaterial(
    password,
    Uint8Array.from(account.kdfSalt),
  );
  // Constant-time, and before anything is minted or written: a wrong password
  // must leave the device exactly as it was.
  if (!equalBytes(authVerifier, Uint8Array.from(account.authVerifier))) {
    throw new Error("Incorrect password.");
  }

  // The account's master key, from the door we just proved (see above) — not the
  // enclave's, which may be a stray key on a device that came back through a door.
  const passwordDoor = await createKeyWrapRepo(driver).getActive({
    wrappedKind: "master",
    principalKind: "password",
  });
  if (passwordDoor === undefined) {
    throw new Error("No password unlock door exists for the master key.");
  }
  const masterKey = unwrapKey(Uint8Array.from(passwordDoor.ciphertext), kek);
  const recoveryKey = generateRecoveryKey();
  await adoptRecoveryKey({
    keyStore,
    driver,
    recoveryKey,
    masterKey,
    writeRecoveryDoor,
  });

  return {
    recoveryPhrase: encodeRecoveryPhrase(recoveryKey),
    recoveryKey,
    masterKey,
  };
}

/**
 * Whether `recoveryKey` is already this device's — the check a peer catch-up runs
 * before re-sealing anything, so the overwhelmingly common case (nothing was
 * rotated) costs one keychain read and no writes.
 *
 * A device with **no** recovery key at all answers `false`, which is deliberate:
 * signing out clears it, and a password unlock cannot bring it back, so a device
 * in that state has been unable to display or use its phrase since. Adopting the
 * account's key there is a repair, not a rotation.
 */
export async function holdsRecoveryKey(
  keyStore: KeyStore,
  recoveryKey: Uint8Array,
): Promise<boolean> {
  const held = await readRecoveryKey(keyStore);
  return held !== undefined && equalBytes(held, recoveryKey);
}
