import { utf8ToBytes } from "@noble/ciphers/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "./base64.js";

/**
 * Derive a **stable** UUID from a `(namespace, name)` pair — the same inputs
 * always yield the same UUID, on any device, with no shared state. This is the
 * spine of cross-device dedup for *content-addressed* rows: when two devices
 * independently mint "the same" record (an upcoming-birthday reminder for the
 * same milestone + year), deriving its `id` from the trigger identity makes both
 * produce an identical `id`, so the existing whole-row LWW merge collapses them
 * into one — **no sync/merge change** (plans automated-reminders, cross-cutting).
 *
 * Construction mirrors RFC 4122 §4.3's name-based (v5) UUID: `sha256(namespace ‖
 * ":" ‖ name)`, first 16 bytes, with the **version nibble set to 5** and the
 * **variant bits set to RFC 4122 (`10x`)**. We hash with SHA-256 (already a
 * dependency, pure-JS on every target) rather than v5's SHA-1 and simply stamp
 * the v5 layout, so the bytes still validate as a UUID: `z.uuid()` accepts any
 * value with a `1`–`8` version nibble and an `[89ab]` variant nibble, which this
 * satisfies. The result is *not* interoperable with a strict RFC v5 generator
 * (different hash) — it only needs to be a valid, deterministic UUID for our own
 * rows, which it is.
 */
export function deterministicUuid(namespace: string, name: string): string {
  // A `:` separator between namespace and name keeps distinct namespaces from
  // colliding; the namespace is a fixed constant string chosen per row family.
  const digest = sha256(utf8ToBytes(`${namespace}:${name}`));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5 in the high nibble of byte 6
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant (10xxxxxx) in byte 8
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
