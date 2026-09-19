import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * The db-key sealed under each door, beside the store as files because they
 * must be read before the database they open. Each is opaque ciphertext.
 */

/** `seal(db-key, KEK)`, opened by the account password. */
export function passwordSidecarPath(dbPath: string): string {
  return `${dbPath}.password`;
}

/** `seal(db-key, recoveryKey)`, opened by the 24-word phrase. */
export function recoverySidecarPath(dbPath: string): string {
  return `${dbPath}.recovery`;
}

/** Read a sidecar, or `undefined` when that door was never written. */
export function readSidecar(path: string): Uint8Array | undefined {
  return existsSync(path) ? Uint8Array.from(readFileSync(path)) : undefined;
}

export function writeSidecar(path: string, bytes: Uint8Array): void {
  writeFileSync(path, bytes);
}
