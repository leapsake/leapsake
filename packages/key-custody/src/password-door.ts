import {
  DATABASE_KEY,
  type KeyStore,
  deriveKeyMaterial,
  sealDbKeyForPassword,
} from "@leapsake/crypto";
import { type SqliteDriver, createAccountRepo } from "@leapsake/data";

/**
 * Seal this device's at-rest **password door** (`model.md` §7.5 Phase 0.5): the
 * `seal(db-key, KEK)` sidecar that lets the account password reopen the encrypted
 * store when the OS keychain is gone. Returns the bytes; persisting them is the
 * client's job, because where they live is platform-specific (a file beside the
 * store on desktop, a row in the unencrypted sidecar database on mobile).
 *
 * **Every path that establishes or changes a password must call this**, because a
 * sidecar is only good for the password it was sealed with and the db-key it was
 * sealed around:
 *
 * - creating an account — this device's first door;
 * - joining, and recovering — a second device has its *own* db-key, so device 1's
 *   sidecar is useless to it;
 * - re-authenticating after a reset elsewhere — the existing sidecar still expects
 *   the *old* password, and nothing surfaces that until the keychain is lost, which
 *   is the worst possible moment to discover it.
 *
 * ### Why the salt is read here rather than passed in
 *
 * The KEK is `Argon2id(password, salt)`, and pairing a password with the wrong salt
 * yields a sidecar that looks written and never opens — a failure invisible until
 * someone needs the door. Reading the salt from the account row makes that
 * mispairing unrepresentable: there is one salt of record, and this is the only
 * place it is fetched. Callers that rotate the salt (`reauthenticate`) must persist
 * the new one **before** calling this; it does, inside the same transaction that
 * swaps the password key-wrap.
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
    // An Open store has no db-key by design (§7.2), so this means a caller ran
    // out of order — the door would seal around nothing.
    throw new Error("This device has no database key to seal.");
  }

  // Copy onto a plain ArrayBuffer-backed array: the salt arrives from a BLOB
  // column, and the KDF + AEAD want the same posture as everywhere else.
  const salt = Uint8Array.from(account.kdfSalt);
  const { kek } = deriveKeyMaterial(password, salt);
  return sealDbKeyForPassword({ dbKey, kek, salt });
}
