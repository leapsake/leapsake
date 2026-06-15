import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";

/**
 * The wrap/AEAD algorithm identifier written into every `key_wrap.alg` column
 * (encryption-schema.md §2.4). Recording it per-row lets the §15.3 security
 * review swap the primitive later without reshaping stored data — old rows keep
 * decrypting under the id they were written with.
 *
 * `xchacha20poly1305.raw@1`: XChaCha20-Poly1305 AEAD, 24-byte random nonce
 * prepended to the ciphertext+tag, no associated data. Pure-JS via
 * `@noble/ciphers`, so it runs identically on Node, Electron, and React Native
 * (which lacks `crypto.subtle`).
 */
export const ALG = "xchacha20poly1305.raw@1";

/** XChaCha20-Poly1305 nonce length, prepended to each sealed blob. */
const NONCE_BYTES = 24;

/**
 * AEAD-encrypt `plaintext` under a 32-byte `key`, returning
 * `nonce(24) ‖ ciphertext+tag`. A fresh random nonce per call means the same
 * plaintext+key never produces the same output, so callers may seal freely
 * without tracking nonces.
 */
export function seal(
  plaintext: Uint8Array,
  key: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return out;
}

/**
 * Reverse {@link seal}: split off the leading nonce and AEAD-decrypt. Throws if
 * the key is wrong or any byte was tampered with — Poly1305 authentication
 * fails closed, which is what makes a flipped ciphertext byte unrecoverable
 * rather than silently wrong.
 */
export function open(sealed: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const ciphertext = sealed.subarray(NONCE_BYTES);
  return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}

/**
 * Wrap a key under a wrapping key. Wrapping a key is just sealing its 32 bytes,
 * so this is {@link seal} under a name that reads correctly at the call site
 * (encryption.md §3 — "the envelope is rows, not codepaths").
 */
export const wrapKey = seal;

/** Unwrap a key wrapped by {@link wrapKey}; {@link open} under a clearer name. */
export const unwrapKey = open;
