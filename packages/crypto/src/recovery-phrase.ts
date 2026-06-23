import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { KEY_BYTES } from "./keys.js";

/**
 * Human-recitable encoding for the 32-byte recovery key (encryption `model.md`
 * §6) — the user-facing form of the master/db-key escape hatch. We render the key
 * as a **BIP39 24-word mnemonic** rather than base64:
 *
 * - **Recitable + paste-robust.** Words survive a phone call, an autocorrecting
 *   text field, and a mangled copy/paste far better than a 43-char base64 run.
 * - **Built-in integrity.** BIP39's last word is a checksum over the entropy, so a
 *   dropped/typo'd word fails {@link decodeRecoveryPhrase} with a clear message —
 *   the user learns "that phrase is wrong" instead of hitting an opaque AEAD
 *   decrypt failure deep in an unwrap.
 * - **Reusable primitive.** The same wordlist is the natural basis for future
 *   device-pairing codes, verbal capability-link sharing, and Signal-style
 *   key-verification fingerprints — so the dependency earns its keep beyond here.
 *
 * Implemented over `@scure/bip39` (audited, pure-JS, same `@noble/*` ecosystem as
 * the rest of this package), so it runs identically on Node/Electron and Hermes.
 * The 32 key bytes are unchanged — this is purely the UI-boundary codec, so every
 * existing recovery wrap stays valid.
 */

/** Words in the mnemonic for a 256-bit key (KEY_BYTES * 8 / 11, rounded up). */
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

/**
 * Decode a recovery phrase back to its 32 key bytes, tolerantly: surrounding and
 * repeated whitespace is collapsed, case is normalized, so a phrase pasted with
 * stray newlines or capitalization still resolves. Throws a friendly error if the
 * words or the BIP39 checksum don't validate — the integrity check that turns a
 * mistyped/truncated phrase into a clear message rather than a downstream unwrap
 * failure.
 */
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
