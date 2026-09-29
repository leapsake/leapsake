import { generateKey } from "./keys.js";
import type { KeyStore } from "./keystore.js";
import { unwrapKey, wrapKey } from "./wrap.js";

// The recovery key behind the phrase, and its db-key sidecar; see the
// README's _The at-rest doors_.

/** KeyStore id holding this device's 32-byte recovery key. */
export const RECOVERY_KEY = "recovery-key";

/** Reads the recovery key, minting and persisting one if absent. */
export async function ensureRecoveryKey(
  keyStore: KeyStore,
): Promise<Uint8Array> {
  const existing = await keyStore.getSecret(RECOVERY_KEY);
  if (existing !== undefined) return existing;
  const key = generateKey();
  await keyStore.setSecret(RECOVERY_KEY, key);
  return key;
}

/** Reads the recovery key without minting one. ⚠️ Use this outside account
 *  creation: an Unauthenticated device holds no keys. */
export async function readRecoveryKey(
  keyStore: KeyStore,
): Promise<Uint8Array | undefined> {
  return keyStore.getSecret(RECOVERY_KEY);
}

/** The recovery sidecar's versioned magic. */
const SIDECAR_MAGIC = Uint8Array.from([0x4c, 0x53, 0x4b, 0x52, 0x31]); // "LSKR1"

/** The recovery sidecar, `"LSKR1" ‖ wrap(dbKey, recoveryKey)`, safe to keep
 *  in plain view beside the store. */
export function sealDbKeyForRecovery(
  dbKey: Uint8Array,
  recoveryKey: Uint8Array,
): Uint8Array {
  const wrapped = wrapKey(dbKey, recoveryKey);
  const out = new Uint8Array(SIDECAR_MAGIC.length + wrapped.length);
  out.set(SIDECAR_MAGIC, 0);
  out.set(wrapped, SIDECAR_MAGIC.length);
  return out;
}

/** Opens the db-key from the recovery sidecar; throws on a bad magic or key. */
export function openDbKeyFromRecovery(
  sidecar: Uint8Array,
  recoveryKey: Uint8Array,
): Uint8Array {
  const magic = sidecar.subarray(0, SIDECAR_MAGIC.length);
  if (
    magic.length !== SIDECAR_MAGIC.length ||
    !magic.every((b, i) => b === SIDECAR_MAGIC[i])
  ) {
    throw new Error("Unrecognized recovery sidecar format.");
  }
  return unwrapKey(sidecar.subarray(SIDECAR_MAGIC.length), recoveryKey);
}
