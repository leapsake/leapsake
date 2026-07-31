import { generateKey } from "./keys.js";
import type { KeyStore } from "./keystore.js";
import { unwrapKey, wrapKey } from "./wrap.js";

/**
 * The device's **recovery key**: a random 256-bit secret, minted once and held in
 * the OS enclave alongside the `db-key` and the device enclave secret. It is the
 * one key behind the user-facing recovery phrase ({@link encodeRecoveryPhrase}),
 * and it is the escape hatch for **both** at-rest loss events (encryption
 * `model.md` §6):
 *
 * - It wraps the whole-DB `db-key` into a **sidecar file** beside the encrypted
 *   database ({@link sealDbKeyForRecovery}). If the enclave is ever lost but the
 *   DB file survives, the phrase reopens the file — the *only* path back, since
 *   the `db-key` deliberately lives nowhere inside the (now-unopenable) DB.
 * - Once sync is enabled it also wraps the master key, locally and escrowed to the
 *   relay, so a fresh device can recover the account after a forgotten password.
 *
 * Keeping a copy in the enclave does not weaken it: its job is to survive *enclave
 * loss*, and when the enclave is intact the phrase is never needed. The enclave
 * copy only lets later steps (enable-sync, sidecar refresh) reuse the one phrase
 * instead of minting a second.
 */

/** KeyStore id holding this device's 32-byte recovery key. */
export const RECOVERY_KEY = "recovery-key";

/** Read the recovery key, minting + persisting one on first launch. Idempotent. */
export async function ensureRecoveryKey(
  keyStore: KeyStore,
): Promise<Uint8Array> {
  const existing = await keyStore.getSecret(RECOVERY_KEY);
  if (existing !== undefined) return existing;
  const key = generateKey();
  await keyStore.setSecret(RECOVERY_KEY, key);
  return key;
}

/**
 * Read the recovery key **without minting one** — `undefined` when this device
 * has none. The read-only sibling of {@link ensureRecoveryKey}, and the one to
 * reach for outside the paths that are *entitled* to create key material.
 *
 * The distinction is load-bearing under *encryption follows custody*
 * (`model.md` §7.2): an **Unauthenticated** device holds no keys at all, and minting one
 * behind the user's back — as a "show me my recovery phrase" button did — both
 * breaks that invariant and hands them 24 words that unlock nothing, since there
 * is no db-key to wrap and no sidecar to open. Only account creation mints.
 */
export async function readRecoveryKey(
  keyStore: KeyStore,
): Promise<Uint8Array | undefined> {
  return keyStore.getSecret(RECOVERY_KEY);
}

/**
 * Magic prefix on the db-key recovery sidecar, so the blob is self-identifying and
 * the format can rev later. `LSKR` = Leapsake Recovery; `1` = version 1.
 */
const SIDECAR_MAGIC = Uint8Array.from([0x4c, 0x53, 0x4b, 0x52, 0x31]); // "LSKR1"

/**
 * Seal the whole-DB `dbKey` under the recovery key for the at-rest recovery
 * sidecar: `"LSKR1" || wrap(dbKey, recoveryKey)`. The result is opaque ciphertext
 * under a full 256-bit key, so it is safe to write to a plaintext location next to
 * the encrypted DB.
 */
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

/**
 * Recover the whole-DB key from a sidecar blob and the recovery key. Throws on a
 * bad magic (not our format) or a wrong recovery key (AEAD unwrap fails) — the
 * caller surfaces both as "that recovery phrase doesn't open this database".
 */
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
