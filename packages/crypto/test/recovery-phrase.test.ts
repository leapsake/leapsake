import { describe, expect, it } from "vitest";
import {
  RECOVERY_PHRASE_WORDS,
  decodeRecoveryPhrase,
  encodeRecoveryPhrase,
} from "../src/recovery-phrase.js";
import { generateKey } from "../src/keys.js";

/** A fixed 32-byte key so the word count + round-trip are deterministic. */
const key = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);

describe("encodeRecoveryPhrase / decodeRecoveryPhrase", () => {
  it("encodes a 32-byte key as a 24-word phrase", () => {
    const phrase = encodeRecoveryPhrase(key);
    expect(phrase.split(" ")).toHaveLength(RECOVERY_PHRASE_WORDS);
  });

  it("round-trips fresh random keys", () => {
    for (let i = 0; i < 20; i++) {
      const k = generateKey();
      expect(decodeRecoveryPhrase(encodeRecoveryPhrase(k))).toEqual(k);
    }
  });

  it("tolerates surrounding/repeated whitespace and case", () => {
    const phrase = encodeRecoveryPhrase(key);
    const mangled = `  ${phrase.replace(/ /g, "   ").toUpperCase()}\n`;
    expect(decodeRecoveryPhrase(mangled)).toEqual(key);
  });

  it("rejects a phrase with a dropped/altered word (checksum)", () => {
    const words = encodeRecoveryPhrase(key).split(" ");
    words.pop(); // drop the checksum word → invalid length + checksum
    expect(() => decodeRecoveryPhrase(words.join(" "))).toThrow(
      /recovery phrase isn't valid/,
    );
  });

  it("rejects a non-wordlist token", () => {
    const words = encodeRecoveryPhrase(key).split(" ");
    words[0] = "notarealbip39word";
    expect(() => decodeRecoveryPhrase(words.join(" "))).toThrow(
      /recovery phrase isn't valid/,
    );
  });

  it("refuses to encode a wrong-length key", () => {
    expect(() => encodeRecoveryPhrase(new Uint8Array(16))).toThrow(/32 bytes/);
  });
});
