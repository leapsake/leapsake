import { randomBytes } from "@noble/ciphers/utils.js";

/** Symmetric key length in bytes, for XChaCha20-Poly1305. */
export const KEY_BYTES = 32;

/** Mints a random symmetric key from the platform CSPRNG. */
export function generateKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}
