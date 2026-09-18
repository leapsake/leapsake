import {
  DATABASE_KEY,
  type KeyStore,
  deriveKeyMaterial,
  sealDbKeyForPassword,
} from "@leapsake/crypto";
import { type SqliteDriver, createAccountRepo } from "@leapsake/data";

/**
 * Seal the password door, `seal(db-key, KEK)`, for the caller to persist. The
 * salt is read from the account row, so a mispaired salt cannot be written.
 */
export async function sealPasswordDoor(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
}): Promise<Uint8Array> {
  const { keyStore, driver, password } = opts;

  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined) {
    throw new Error("No account on this store to seal a password door for.");
  }
  const dbKey = await keyStore.getSecret(DATABASE_KEY);
  if (dbKey === undefined) {
    // No db-key means a caller ran out of order: the door would seal nothing.
    throw new Error("This device has no database key to seal.");
  }

  // Copy onto a plain ArrayBuffer-backed array: the salt arrives from a BLOB
  // column, and the KDF + AEAD want the same posture as everywhere else.
  const salt = Uint8Array.from(account.kdfSalt);
  const { kek } = deriveKeyMaterial(password, salt);
  return sealDbKeyForPassword({ dbKey, kek, salt });
}
