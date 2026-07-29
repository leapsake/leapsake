export { ALG, seal, open, wrapKey, unwrapKey } from "./wrap.js";
export { KEY_BYTES, generateKey } from "./keys.js";
export {
  KDF_ALG,
  ARGON2_PARAMS,
  SALT_BYTES,
  type KeyMaterial,
  deriveKeyMaterial,
  deriveRecoveryVerifier,
  generateSalt,
  generateRecoveryKey,
} from "./kdf.js";
export { type KeyStore, createInMemoryKeyStore } from "./keystore.js";
export {
  DATABASE_KEY,
  ensureDatabaseKey,
  rawKeyLiteral,
} from "./database-key.js";
export {
  RECOVERY_KEY,
  ensureRecoveryKey,
  readRecoveryKey,
  sealDbKeyForRecovery,
  openDbKeyFromRecovery,
} from "./recovery.js";
export {
  RECOVERY_PHRASE_WORDS,
  encodeRecoveryPhrase,
  decodeRecoveryPhrase,
} from "./recovery-phrase.js";
// Constant-time byte comparison, for checking an auth verifier without leaking
// timing. Re-exported from `@noble/ciphers`, pure-JS on every target.
//
// This stays here rather than moving to `@leapsake/bytes` with the other byte
// helpers: it looks like a codec utility, but its whole reason to exist is not
// leaking timing on a secret comparison, which makes it a security primitive.
export { equalBytes } from "@noble/ciphers/utils.js";
