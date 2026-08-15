import { randomBytes, utf8ToBytes } from "@noble/ciphers/utils.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { KEY_BYTES, generateKey } from "./keys.js";

/**
 * The password key-derivation algorithm identifier, recorded alongside an
 * account so the primitive can change later without locking out existing
 * accounts — the same per-record-`alg` posture as the wrap {@link ALG}
 * (plans/encryption/security-review.md). An account derives under the id it was
 * created with.
 *
 * `argon2id-hkdf-sha256@1`: one Argon2id pass over the password produces a
 * 32-byte seed, then HKDF-SHA256 splits that seed into two independent 32-byte
 * outputs (the KEK and the auth verifier). Pure-JS via `@noble/hashes`, so it
 * runs identically on Node, Electron, and React Native (Hermes).
 */
export const KDF_ALG = "argon2id-hkdf-sha256@1";

/**
 * Argon2id cost parameters (RFC 9106 / OWASP interactive profile): 19 MiB of
 * memory, two passes, no parallelism, a 32-byte output. Named here so they are
 * recorded and swappable, never buried at the call site. Raising them later is a
 * new `KDF_ALG` revision, not a code reshape (old accounts keep their id).
 */
export const ARGON2_PARAMS = {
  /** Memory cost in KiB (19 MiB). */
  m: 19_456,
  /** Time cost — number of passes. */
  t: 2,
  /** Parallelism (lanes). */
  p: 1,
  /** Derived seed length in bytes. */
  dkLen: KEY_BYTES,
} as const;

/** Argon2id salt length in bytes (≥ 8 required by the primitive). */
export const SALT_BYTES = 16;

/**
 * HKDF `info` labels that domain-separate the single Argon2id seed into two
 * independent keys. Because HKDF outputs are independent, the value stored on
 * the server (the auth verifier) reveals nothing about the encryption KEK — the
 * §9.3 "two values from one password" split.
 */
const KEK_INFO = utf8ToBytes("leapsake:kek:v1");
const AUTH_INFO = utf8ToBytes("leapsake:auth:v1");

/**
 * Domain-separation label for the **recovery auth verifier** — the relay-side
 * proof of possession for the recovery key, the recovery sibling of `AUTH_INFO`.
 * Derived from the high-entropy recovery key (not a password), so it needs no
 * Argon2id; one HKDF branch yields a verifier whose stored hash lets the relay
 * authenticate a "forgot password" recovery without ever seeing the key
 * (`model.md` §6). Independent of the KEK/auth branches.
 */
const RECOVERY_AUTH_INFO = utf8ToBytes("leapsake:recovery-auth:v1");

/**
 * The two secrets derived from a password + the account's public salt:
 *
 * - `kek` — the key-encryption-key that wraps the master key (never leaves the
 *   client; the server must never be able to derive it).
 * - `authVerifier` — what the server stores to authenticate login. It is a
 *   separate HKDF branch of the same seed, so possessing it does not reveal the
 *   KEK (`model.md` §9.3).
 */
export interface KeyMaterial {
  kek: Uint8Array<ArrayBuffer>;
  authVerifier: Uint8Array<ArrayBuffer>;
}

/**
 * Derive the KEK and the auth verifier from a password and the account salt.
 * Runs Argon2id once (the expensive step), then HKDF-expands the seed into the
 * two independent outputs. Deterministic for a given (password, salt), so a
 * second device that types the same password reaches the same KEK — and thus
 * the same wrapped master key — with no enclave involved.
 */
export function deriveKeyMaterial(
  password: string,
  salt: Uint8Array,
): KeyMaterial {
  const seed = argon2id(password, salt, ARGON2_PARAMS);
  // Copy onto a plain ArrayBuffer-backed Uint8Array so the bytes flow cleanly
  // into the BLOB-typed schema fields and crypto primitives on every target.
  return {
    kek: Uint8Array.from(hkdf(sha256, seed, undefined, KEK_INFO, KEY_BYTES)),
    authVerifier: Uint8Array.from(
      hkdf(sha256, seed, undefined, AUTH_INFO, KEY_BYTES),
    ),
  };
}

/** Mint a fresh random Argon2id salt for a new account (public, stored). */
export function generateSalt(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(randomBytes(SALT_BYTES));
}

/**
 * Derive the recovery auth verifier from the 32-byte recovery key — one HKDF
 * branch under {@link RECOVERY_AUTH_INFO}. The relay stores only `sha256` of this
 * (never the recovery key, never this verifier), so a device that lost its
 * password can prove possession of the recovery key to fetch the recovery-wrapped
 * master key and reset its password, all without the relay learning anything that
 * decrypts data (`model.md` §6). No Argon2id: the recovery key is already
 * high-entropy, so an HKDF expansion is sufficient (mirrors why the password path
 * needs Argon2id but this does not).
 */
export function deriveRecoveryVerifier(
  recoveryKey: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    hkdf(sha256, recoveryKey, undefined, RECOVERY_AUTH_INFO, KEY_BYTES),
  );
}

/**
 * Mint a recovery key — a 32-byte high-entropy secret shown to the user once at
 * sync-enable (`model.md` §6) as an out-of-band unlock path for the master key.
 * It is never stored by us; the human-readable encoding is a UI concern.
 */
export const generateRecoveryKey = generateKey;
