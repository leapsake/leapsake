import { bytesToHex } from "@leapsake/bytes";
import { generateKey } from "./keys.js";
import type { KeyStore } from "./keystore.js";

/**
 * The whole-DB key for at-rest encryption (Stage 2, encryption `model.md` §8): a
 * random 256-bit key minted once on first launch and held **only** in the OS
 * enclave via the {@link KeyStore}, alongside the existing `enclave` / `device-id`
 * secrets.
 *
 * It is deliberately **not** a `key_wrap` row: that table lives *inside* the
 * encrypted database, so storing the DB key there would be a chicken-and-egg (you
 * would need the key to read the key). The enclave already protects it, and it
 * stays independent of the in-DB master-key hierarchy — at-rest protects the
 * *file*; per-item content keys (wrapped under the master key) live *inside* the
 * decrypted DB and are the sync/sharing envelope. They compose and do not interact.
 *
 * Shared across clients: desktop supplies it to `better-sqlite3-multiple-ciphers`;
 * mobile supplies it to expo-sqlite's SQLCipher via `PRAGMA key`. Both consume the
 * same key under the same custody pattern — see each client's DB bootstrap.
 */

/** KeyStore id holding this device's 32-byte whole-DB encryption key. */
export const DATABASE_KEY = "db-key";

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

/**
 * SQLCipher's raw-key form: a 32-byte key rendered as `x'<64 hex>'` is used
 * directly, with no KDF iteration — exactly right for our already-random 256-bit
 * enclave key. Used by both clients' encrypted-DB open paths (`PRAGMA key` on
 * mobile, the `key`/`rekey` pragmas on desktop).
 */
export function rawKeyLiteral(key: Uint8Array): string {
  return `x'${bytesToHex(key)}'`;
}
