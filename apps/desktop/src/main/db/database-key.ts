import { type KeyStore, generateKey } from "@leapsake/crypto";

/**
 * The whole-DB key for at-rest encryption (Stage 2, `model.md` §8): a random
 * 256-bit key minted once on first launch and held **only** in the OS enclave via
 * the {@link KeyStore}, alongside the existing `enclave` / `device-id` secrets.
 *
 * It is deliberately **not** a `key_wrap` row: that table lives *inside* the
 * encrypted database, so storing the DB key there would be a chicken-and-egg (you
 * would need the key to read the key). The enclave already protects it, and it
 * stays independent of the in-DB master-key hierarchy — see `database-key`'s use
 * in `index.ts`, supplied to `openEncryptedDatabase` before migrations.
 *
 * Desktop-local for now (the only at-rest client this increment); it lifts to a
 * shared package unchanged when mobile gains at-rest encryption.
 */

/** KeyStore id holding this device's 32-byte whole-DB encryption key. */
const DATABASE_KEY = "db-key";

/** Read the whole-DB key, minting + persisting one on first launch. Idempotent. */
export async function ensureDatabaseKey(
  keyStore: KeyStore,
): Promise<Uint8Array> {
  const existing = await keyStore.getSecret(DATABASE_KEY);
  if (existing !== undefined) return existing;
  const key = generateKey();
  await keyStore.setSecret(DATABASE_KEY, key);
  return key;
}
