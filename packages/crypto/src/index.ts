export { ALG, seal, open, wrapKey, unwrapKey } from "./wrap.js";
export { KEY_BYTES, generateKey } from "./keys.js";
export {
  KDF_ALG,
  ARGON2_PARAMS,
  SALT_BYTES,
  type KeyMaterial,
  deriveKeyMaterial,
  setKdfParamsForTests,
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
  sealDbKeyForPassword,
  openDbKeyWithPassword,
  openPasswordSidecar,
} from "./password-sidecar.js";
export {
  RECOVERY_PHRASE_WORDS,
  encodeRecoveryPhrase,
  decodeRecoveryPhrase,
} from "./recovery-phrase.js";
// Constant-time comparison, for an auth verifier; a security primitive, not a
// codec, so it stays out of `@leapsake/bytes`.
export { equalBytes } from "@noble/ciphers/utils.js";
