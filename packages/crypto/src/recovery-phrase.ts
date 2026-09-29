import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { KEY_BYTES } from "./keys.js";

// The recovery key as a BIP39 24-word phrase; see the README's _The recovery
// phrase_.

/** Words in the mnemonic for a 256-bit key. */
export const RECOVERY_PHRASE_WORDS = 24;

/** Encode a 32-byte recovery key as its 24-word recovery phrase. */
export function encodeRecoveryPhrase(bytes: Uint8Array): string {
  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      `Recovery key must be ${KEY_BYTES} bytes, got ${bytes.length}.`,
    );
  }
  return entropyToMnemonic(bytes, wordlist);
}

/** Decodes a phrase, ignoring whitespace and case; a bad word or checksum
 *  throws a friendly error before any unwrap. */
export function decodeRecoveryPhrase(text: string): Uint8Array {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  try {
    return mnemonicToEntropy(normalized, wordlist);
  } catch {
    throw new Error(
      "That recovery phrase isn't valid — check the words and try again.",
    );
  }
}
