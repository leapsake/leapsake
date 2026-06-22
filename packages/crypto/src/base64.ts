/**
 * Byte ↔ string codecs for the OS `KeyStore` adapters. Pure-JS (no `Buffer`,
 * no `btoa`/`atob`) so the identical code runs on Node/Electron and on React
 * Native's Hermes, which ships neither. Used to encode secret and ciphertext
 * bytes as compact strings for storage (desktop `keystore.json` values, mobile
 * `expo-secure-store` values) and to derive storage-safe keys.
 */

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Reverse lookup: char code → 6-bit value; -1 for anything not in the alphabet. */
const BASE64_LOOKUP = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Encode bytes as standard (padded) base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      BASE64_ALPHABET[(n >> 18) & 63]! +
      BASE64_ALPHABET[(n >> 12) & 63]! +
      BASE64_ALPHABET[(n >> 6) & 63]! +
      BASE64_ALPHABET[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out +=
      BASE64_ALPHABET[(n >> 18) & 63]! +
      BASE64_ALPHABET[(n >> 12) & 63]! +
      "==";
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out +=
      BASE64_ALPHABET[(n >> 18) & 63]! +
      BASE64_ALPHABET[(n >> 12) & 63]! +
      BASE64_ALPHABET[(n >> 6) & 63]! +
      "=";
  }
  return out;
}

/** Decode standard base64 back to bytes. Throws on a malformed string. */
export function base64ToBytes(text: string): Uint8Array {
  let len = text.length;
  if (len % 4 !== 0)
    throw new Error("Invalid base64: length not a multiple of 4");
  if (len === 0) return new Uint8Array(0);

  let pad = 0;
  if (text[len - 1] === "=") pad++;
  if (text[len - 2] === "=") pad++;

  const out = new Uint8Array((len / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = sextet(text, i);
    const b = sextet(text, i + 1);
    const c = text[i + 2] === "=" ? 0 : sextet(text, i + 2);
    const d = text[i + 3] === "=" ? 0 : sextet(text, i + 3);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

/** Look up one base64 character's 6-bit value, throwing if it is invalid. */
function sextet(text: string, index: number): number {
  const code = text.charCodeAt(index);
  const value = code < 128 ? BASE64_LOOKUP[code]! : -1;
  if (value < 0) throw new Error(`Invalid base64 character: ${text[index]}`);
  return value;
}

/**
 * Encode bytes as lowercase hex. Used to turn an arbitrary `KeyStore` id into a
 * storage key restricted to `[A-Za-z0-9._-]` (e.g. `expo-secure-store` rejects
 * the `:` in `payload:<uuid>`); hex is unambiguously inside that alphabet.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Decode lowercase/uppercase hex back to bytes. Throws on a malformed string. */
export function hexToBytes(text: string): Uint8Array {
  if (text.length % 2 !== 0) throw new Error("Invalid hex: odd length");
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("Invalid hex character");
    out[i] = byte;
  }
  return out;
}
