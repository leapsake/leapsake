import { SALT_BYTES, deriveKeyMaterial } from "./kdf.js";
import { unwrapKey, wrapKey } from "./wrap.js";

// The password door on the db-key: `"LSKP1" ‖ salt(16) ‖ wrap(dbKey, KEK)`.
// See the README's _The at-rest doors_.

/** Versioned magic, distinct from the recovery sidecar's, so a swapped file
 *  fails on it rather than inside the AEAD. */
const SIDECAR_MAGIC = Uint8Array.from([0x4c, 0x53, 0x4b, 0x50, 0x31]); // "LSKP1"

/** Where the sealed key starts: after the magic and the salt. */
const BODY_OFFSET = SIDECAR_MAGIC.length + SALT_BYTES;

/** Seals the db-key under a KEK its caller just derived. ⚠️ `salt` must be the
 *  KEK's own; call `sealPasswordDoor` rather than this. */
export function sealDbKeyForPassword(opts: {
  dbKey: Uint8Array;
  kek: Uint8Array;
  salt: Uint8Array;
}): Uint8Array {
  const { dbKey, kek, salt } = opts;
  if (salt.length !== SALT_BYTES) {
    throw new Error(`Password sidecar salt must be ${SALT_BYTES} bytes.`);
  }
  const wrapped = wrapKey(dbKey, kek);
  const out = new Uint8Array(BODY_OFFSET + wrapped.length);
  out.set(SIDECAR_MAGIC, 0);
  out.set(salt, SIDECAR_MAGIC.length);
  out.set(wrapped, BODY_OFFSET);
  return out;
}

/** Opens the db-key with the password and the salt in the blob, returning the
 *  key material too; throws on any bad blob or password. */
export function openPasswordSidecar(
  sidecar: Uint8Array,
  password: string,
): { dbKey: Uint8Array; kek: Uint8Array; authVerifier: Uint8Array } {
  const magic = sidecar.subarray(0, SIDECAR_MAGIC.length);
  if (
    sidecar.length <= BODY_OFFSET ||
    magic.length !== SIDECAR_MAGIC.length ||
    !magic.every((b, i) => b === SIDECAR_MAGIC[i])
  ) {
    throw new Error("Unrecognized password sidecar format.");
  }
  const salt = sidecar.subarray(SIDECAR_MAGIC.length, BODY_OFFSET);
  const { kek, authVerifier } = deriveKeyMaterial(password, salt);
  return {
    dbKey: unwrapKey(sidecar.subarray(BODY_OFFSET), kek),
    kek,
    authVerifier,
  };
}

/** {@link openPasswordSidecar} for the callers that only want the db-key. */
export function openDbKeyWithPassword(
  sidecar: Uint8Array,
  password: string,
): Uint8Array {
  return openPasswordSidecar(sidecar, password).dbKey;
}
