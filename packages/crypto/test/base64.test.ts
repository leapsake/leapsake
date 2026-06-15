import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
} from "../src/base64.js";

/** Bytes [0, 1, 2, …, 255] — exercises every byte value and all pad lengths. */
const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i);

const enc = (s: string) => bytesToBase64(new TextEncoder().encode(s));
const dec = (s: string) => new TextDecoder().decode(base64ToBytes(s));

describe("bytesToBase64 / base64ToBytes", () => {
  it("encodes known vectors (RFC 4648)", () => {
    expect(enc("")).toBe("");
    expect(enc("f")).toBe("Zg==");
    expect(enc("fo")).toBe("Zm8=");
    expect(enc("foo")).toBe("Zm9v");
    expect(enc("foob")).toBe("Zm9vYg==");
    expect(enc("fooba")).toBe("Zm9vYmE=");
    expect(enc("foobar")).toBe("Zm9vYmFy");
  });

  it("decodes known vectors back to text", () => {
    expect(dec("")).toBe("");
    expect(dec("Zg==")).toBe("f");
    expect(dec("Zm8=")).toBe("fo");
    expect(dec("Zm9vYmFy")).toBe("foobar");
  });

  it("round-trips empty, single-byte, and all-256-value inputs", () => {
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array([0]),
      new Uint8Array([255]),
      new Uint8Array([0, 255]),
      new Uint8Array([1, 2, 3]),
      allBytes,
    ]) {
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it("rejects malformed base64", () => {
    expect(() => base64ToBytes("Zg=")).toThrow(); // length not multiple of 4
    expect(() => base64ToBytes("Z!==")).toThrow(); // illegal character
  });
});

describe("bytesToHex / hexToBytes", () => {
  it("encodes lowercase, zero-padded hex", () => {
    expect(bytesToHex(new Uint8Array([0, 15, 16, 255]))).toBe("000f10ff");
    expect(bytesToHex(new Uint8Array(0))).toBe("");
  });

  it("produces a secure-store-safe key from an id with a colon", () => {
    const key = bytesToHex(new TextEncoder().encode("payload:abc"));
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it("round-trips all-256-value input", () => {
    expect(hexToBytes(bytesToHex(allBytes))).toEqual(allBytes);
  });

  it("rejects malformed hex", () => {
    expect(() => hexToBytes("abc")).toThrow(); // odd length
    expect(() => hexToBytes("zz")).toThrow(); // illegal character
  });
});
