import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * The two **db-key sidecars** that sit beside an encrypted store (`model.md` §7.5
 * Phase 0.5), and the only place their paths are formed.
 *
 * Both hold the same secret — the whole-DB key — sealed under a different door:
 * one the user chose (their password), one we generated (the 24-word phrase).
 * They are separate files rather than rows because they must be read *before* the
 * database they open, which is also why they are plaintext locations: each is
 * opaque ciphertext under a full 256-bit key, so the file being readable reveals
 * nothing.
 *
 * The password one is the everyday answer — someone who remembers their password
 * should never be sent hunting for words they may not have written down. The
 * recovery one is the backstop for when the password is gone too.
 */

/** `seal(db-key, KEK)` — opened by the account password (`password-sidecar.ts`). */
export function passwordSidecarPath(dbPath: string): string {
  return `${dbPath}.password`;
}

/** `seal(db-key, recoveryKey)` — opened by the 24-word phrase (`recovery.ts`). */
export function recoverySidecarPath(dbPath: string): string {
  return `${dbPath}.recovery`;
}

/** Read a sidecar, or `undefined` when that door was never written. */
export function readSidecar(path: string): Uint8Array | undefined {
  return existsSync(path) ? Uint8Array.from(readFileSync(path)) : undefined;
}

/** Write (or replace) a sidecar. */
export function writeSidecar(path: string, bytes: Uint8Array): void {
  writeFileSync(path, bytes);
}
