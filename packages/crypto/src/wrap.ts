import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";

/** The AEAD id every `key_wrap.alg` records, so old rows keep decrypting after
 *  the primitive changes. */
export const ALG = "xchacha20poly1305.raw@1";

/** XChaCha20-Poly1305 nonce length, prepended to each sealed blob. */
const NONCE_BYTES = 24;

/** Poly1305's tag length, the least a valid ciphertext carries. */
const TAG_BYTES = 16;

/** Seals `plaintext` as `nonce(24) ‖ ciphertext+tag`, a random nonce each
 *  call. */
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

/** Opens a sealed value, throwing on a wrong key, a tampered byte, or a blob
 *  too short to hold a nonce and tag. */
export function open(sealed: Uint8Array, key: Uint8Array): Uint8Array {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error("sealed blob too short");
  }
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const ciphertext = sealed.subarray(NONCE_BYTES);
  return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}

/** {@link seal}, named for wrapping a key. */
export const wrapKey = seal;

/** {@link open}, named for unwrapping a key. */
export const unwrapKey = open;
