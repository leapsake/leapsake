import { randomBytes } from "@noble/ciphers/utils.js";

/** Symmetric key length in bytes — 256-bit keys for XChaCha20-Poly1305. */
export const KEY_BYTES = 32;

/**
 * Mint a fresh random symmetric key (master key, content key, or device
 * enclave secret). Backed by `@noble/ciphers` `randomBytes`, which draws from
 * the platform CSPRNG (`crypto.getRandomValues`) on every target.
 */
export function generateKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}
