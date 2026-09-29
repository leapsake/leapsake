import { bytesToHex } from "@leapsake/bytes";
import { generateKey } from "./keys.js";
import type { KeyStore } from "./keystore.js";

// The whole-DB key, held only in the OS keychain; see the README's _The
// at-rest doors_.

/** KeyStore id holding this device's 32-byte whole-DB encryption key. */
export const DATABASE_KEY = "db-key";

/** Reads the whole-DB key, minting and persisting one on first launch. */
export async function ensureDatabaseKey(
  keyStore: KeyStore,
): Promise<Uint8Array> {
  const existing = await keyStore.getSecret(DATABASE_KEY);
  if (existing !== undefined) return existing;
  const key = generateKey();
  await keyStore.setSecret(DATABASE_KEY, key);
  return key;
}

/** A key as SQLCipher's raw `x'<64 hex>'` form, used with no KDF, as a random
 *  key needs none. */
export function rawKeyLiteral(key: Uint8Array): string {
  return `x'${bytesToHex(key)}'`;
}
