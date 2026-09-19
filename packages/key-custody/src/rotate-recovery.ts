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

// Replacing the recovery phrase: compromise response, not recovery, since it
// needs the password the phrase exists to replace.

/** Persist this device's at-rest recovery door, `seal(db-key, recoveryKey)`;
 *  where it lands differs per client. */
export type RecoveryDoorWriter = (door: Uint8Array) => Promise<void> | void;

/**
 * Make `recoveryKey` this device's: db-key door, recovery key-wrap, then the
 * keychain copy, in that order so a crash leaves the old phrase working.
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
    // An Unauthenticated store has no db-key and no phrase to rotate.
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
 * Mint a new recovery key, gated locally on the password; return the phrase to
 * show once. MK comes from the password door; the relay escrow follows.
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

  // MK from the door just proved, not the enclave, which may hold a stray key
  // on a device that came back through a door.
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

/** Whether `recoveryKey` is already this device's. No recovery key at all
 *  answers `false`, so adopting there repairs a signed-out device. */
export async function holdsRecoveryKey(
  keyStore: KeyStore,
  recoveryKey: Uint8Array,
): Promise<boolean> {
  const held = await readRecoveryKey(keyStore);
  return held !== undefined && equalBytes(held, recoveryKey);
}
