import { utf8ToBytes } from "@noble/ciphers/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "./base64.js";

/** A stable UUID from `(namespace, name)`, identical on every device: SHA-256
 *  in the v5 layout, so it validates but is not RFC v5. */
export function deterministicUuid(namespace: string, name: string): string {
  // The `:` keeps distinct namespaces from colliding.
  const digest = sha256(utf8ToBytes(`${namespace}:${name}`));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5 in the high nibble of byte 6
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant (10xxxxxx) in byte 8
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
