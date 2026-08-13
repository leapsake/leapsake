import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";

/**
 * Standard base64 ↔ the **URL alphabet**, which two things here need and
 * `@leapsake/bytes` deliberately does not ship.
 *
 * `bytesToBase64` emits standard base64, whose `+`, `/` and `=` are wrong in a
 * cookie value and wrong in a URL fragment. The session cookie needed that
 * conversion first (`session.ts`); Increment 4's capability links need exactly
 * the same one for the key they carry in `#fragment`, so it moved here rather
 * than being written twice.
 *
 * **Only where the alphabet matters.** Ciphertext going into an HTML *attribute*
 * stays standard base64 (`shares.ts`), because an attribute value has no opinion
 * about `+` or `/` — converting it would be cargo cult.
 */
export function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const standard = text.replaceAll("-", "+").replaceAll("_", "/");
  return base64ToBytes(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
}
