/**
 * `@leapsake/bytes` — the low-level codecs: bytes ↔ string, and the
 * content-addressed id derived from them. Pure JS on every target (no `Buffer`,
 * no `btoa`/`atob`, no `TextEncoder`), so identical code runs on Node/Electron
 * and on React Native's Hermes.
 *
 * **The membership rule is a security boundary, not a taxonomy.** These are
 * codecs over *non-secret* data: the base64 that puts ciphertext on the wire, the
 * hex that makes a storage key `[A-Za-z0-9._-]`-safe, and the `sha256` that turns
 * a `(namespace, name)` pair into a stable public id. Nothing here touches key
 * material, so nothing here needs the scrutiny `@leapsake/crypto` does.
 *
 * That split is what the package exists for. Previously these lived in
 * `@leapsake/crypto`, so `@leapsake/reminders` — which only ever wanted a
 * deterministic id — declared a dependency on the security package, and "which
 * code handles secrets?" could not be answered from the dependency graph. Now it
 * can: **depend on `crypto` only if you handle keys or ciphertext.**
 *
 * Deliberately *not* here: `equalBytes`. Constant-time comparison looks like a
 * byte utility but exists to check an auth verifier without leaking timing
 * (`key-custody/src/session.ts`), which makes it a security primitive. It stays in `crypto`.
 */
export {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
} from "./base64.js";
export { deterministicUuid } from "./deterministic-id.js";
// UTF-8 string ↔ bytes, for storing text identifiers (e.g. a device UUID) as
// KeyStore secrets and for sealing JSON rows. Re-exported from `@noble/ciphers`,
// which implements them in pure JS — so they run identically on Node/Electron
// and Hermes, with no reliance on a global `TextEncoder`/`TextDecoder`.
export { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils.js";
