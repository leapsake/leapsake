import { describe, expect, it } from "vitest";
import { generateKey } from "../src/keys.js";
import { open, seal, unwrapKey, wrapKey } from "../src/wrap.js";

describe("seal/open", () => {
  it("round-trips a payload", () => {
    const key = generateKey();
    const plaintext = new TextEncoder().encode("a secret payload");
    const recovered = open(seal(plaintext, key), key);
    expect(recovered).toEqual(plaintext);
  });

  it("uses a distinct nonce per call, so identical inputs differ", () => {
    const key = generateKey();
    const plaintext = new TextEncoder().encode("same input");
    const a = seal(plaintext, key);
    const b = seal(plaintext, key);
    expect(a).not.toEqual(b);
    // Both still decrypt back to the original.
    expect(open(a, key)).toEqual(plaintext);
    expect(open(b, key)).toEqual(plaintext);
  });

  it("throws when a ciphertext byte is tampered with", () => {
    const key = generateKey();
    const sealed = seal(new TextEncoder().encode("tamper me"), key);
    // Flip a byte in the ciphertext+tag region (past the 24-byte nonce).
    sealed[sealed.length - 1] ^= 0x01;
    expect(() => open(sealed, key)).toThrow();
  });

  it("throws when opened with the wrong key", () => {
    const sealed = seal(new TextEncoder().encode("hands off"), generateKey());
    expect(() => open(sealed, generateKey())).toThrow();
  });
});

describe("wrapKey/unwrapKey", () => {
  it("wraps and unwraps a 32-byte key", () => {
    const wrappingKey = generateKey();
    const key = generateKey();
    const wrapped = wrapKey(key, wrappingKey);
    expect(wrapped).not.toEqual(key);
    expect(unwrapKey(wrapped, wrappingKey)).toEqual(key);
  });
});
