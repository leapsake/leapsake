export { ALG, seal, open, wrapKey, unwrapKey } from "./wrap.js";
export { KEY_BYTES, generateKey } from "./keys.js";
export { type KeyStore, createInMemoryKeyStore } from "./keystore.js";
export {
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
  hexToBytes,
} from "./base64.js";
// UTF-8 string ↔ bytes, for storing text identifiers (e.g. a device UUID) as
// KeyStore secrets. Re-exported from `@noble/ciphers`, which implements them in
// pure JS — so they run identically on Node/Electron and Hermes, with no
// reliance on a global `TextEncoder`/`TextDecoder`.
export { utf8ToBytes, bytesToUtf8 } from "@noble/ciphers/utils.js";
