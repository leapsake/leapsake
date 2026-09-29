import { base64, hex } from "@scure/base";

/** Encode bytes as standard (padded) base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

/** Decode standard base64 back to bytes. Throws on a malformed string. */
export function base64ToBytes(text: string): Uint8Array {
  return base64.decode(text);
}

/** Encodes bytes as lowercase hex, safe as an `expo-secure-store` key. */
export function bytesToHex(bytes: Uint8Array): string {
  return hex.encode(bytes);
}

/** Decode hex of either case back to bytes. Throws on a malformed string. */
export function hexToBytes(text: string): Uint8Array {
  return hex.decode(text);
}
