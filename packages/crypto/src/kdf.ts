import { randomBytes, utf8ToBytes } from "@noble/ciphers/utils.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { KEY_BYTES, generateKey } from "./keys.js";

/** The password KDF's id, recorded per account, which derives under it for
 *  good: one Argon2id pass, split by HKDF-SHA256. */
export const KDF_ALG = "argon2id-hkdf-sha256@1";

/** Argon2id's cost, the OWASP interactive profile; raising it is a new
 *  `KDF_ALG`. */
export const ARGON2_PARAMS = {
  /** Memory cost in KiB (19 MiB). */
  m: 19_456,
  /** Time cost: the number of passes. */
  t: 2,
  /** Parallelism (lanes). */
  p: 1,
  /** Derived seed length in bytes. */
  dkLen: KEY_BYTES,
} as const;

/** The Argon2id cost a test may ask for; the seed length is fixed. */
interface Argon2Params {
  m: number;
  t: number;
  p: number;
  dkLen: typeof KEY_BYTES;
}

/** The cost {@link deriveKeyMaterial} runs at, unless a test lowers it. */
let argon2Params: Argon2Params = ARGON2_PARAMS;

/** Lowers the Argon2id cost for the rest of the process; refused outside
 *  Vitest. */
export function setKdfParamsForTests(
  params: Partial<Omit<Argon2Params, "dkLen">>,
): void {
  if (typeof process === "undefined" || !process.env.VITEST) {
    throw new Error(
      "setKdfParamsForTests is available only under Vitest — key derivation keeps its production cost everywhere else",
    );
  }
  argon2Params = { ...ARGON2_PARAMS, ...params };
}

/** Argon2id salt length in bytes (≥ 8 required by the primitive). */
export const SALT_BYTES = 16;

/** HKDF labels splitting one seed into independent keys; keep them distinct. */
const KEK_INFO = utf8ToBytes("leapsake:kek:v1");
const AUTH_INFO = utf8ToBytes("leapsake:auth:v1");

/** The recovery verifier's label: HKDF over the recovery key, which needs no
 *  Argon2id as it is already high-entropy. */
const RECOVERY_AUTH_INFO = utf8ToBytes("leapsake:recovery-auth:v1");

/** A password's two secrets: the `kek`, which never leaves the client, and
 *  the `authVerifier` the server stores. */
export interface KeyMaterial {
  kek: Uint8Array<ArrayBuffer>;
  authVerifier: Uint8Array<ArrayBuffer>;
}

/** Derives the KEK and verifier with one Argon2id pass; deterministic, so any
 *  device with the password reaches the same KEK. */
export function deriveKeyMaterial(
  password: string,
  salt: Uint8Array,
): KeyMaterial {
  const seed = argon2id(password, salt, argon2Params);
  // Copied onto a plain ArrayBuffer, which the BLOB fields expect.
  return {
    kek: Uint8Array.from(hkdf(sha256, seed, undefined, KEK_INFO, KEY_BYTES)),
    authVerifier: Uint8Array.from(
      hkdf(sha256, seed, undefined, AUTH_INFO, KEY_BYTES),
    ),
  };
}

/** Mints a new account's public Argon2id salt. */
export function generateSalt(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(randomBytes(SALT_BYTES));
}

/** The recovery verifier, whose hash is all the relay stores to authenticate
 *  a recovery. */
export function deriveRecoveryVerifier(
  recoveryKey: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    hkdf(sha256, recoveryKey, undefined, RECOVERY_AUTH_INFO, KEY_BYTES),
  );
}

/** Mints a recovery key, the secret behind the phrase shown once. */
export const generateRecoveryKey = generateKey;
