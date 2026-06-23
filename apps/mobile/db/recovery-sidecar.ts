import * as SQLite from "expo-sqlite";
import { base64ToBytes, bytesToBase64 } from "@leapsake/crypto";

/**
 * The mobile at-rest **recovery sidecar** (encryption `model.md` §6): the
 * `wrap(db-key, recoveryKey)` blob that lets the recovery phrase reopen the
 * encrypted database if this device's enclave key is ever lost. The desktop
 * counterpart is a plaintext file beside the DB (`open.ts`); on mobile, where we
 * have no general filesystem dependency, it lives in a **separate, unencrypted**
 * expo-sqlite database — opened with no `PRAGMA key`, so it is readable without
 * the (now-missing) enclave key. Storing it unencrypted is safe: the blob is
 * opaque ciphertext under a full 256-bit key.
 *
 * It must never be the same database as `leapsake.db` (that one is the thing we
 * can't open without the key), and it is intentionally device-local — never synced.
 */
const SIDECAR_DB = "leapsake-recovery.db";
const SCHEMA =
  "CREATE TABLE IF NOT EXISTS sidecar (id INTEGER PRIMARY KEY CHECK (id = 1), blob TEXT NOT NULL)";

/** Read the stored sidecar blob, or `undefined` if none has been written yet. */
export async function readRecoverySidecar(): Promise<Uint8Array | undefined> {
  const db = await SQLite.openDatabaseAsync(SIDECAR_DB);
  try {
    await db.execAsync(SCHEMA);
    const row = await db.getFirstAsync<{ blob: string }>(
      "SELECT blob FROM sidecar WHERE id = 1",
    );
    return row === null ? undefined : base64ToBytes(row.blob);
  } finally {
    await db.closeAsync();
  }
}

/** Write (or replace) the sidecar blob. */
export async function writeRecoverySidecar(bytes: Uint8Array): Promise<void> {
  const db = await SQLite.openDatabaseAsync(SIDECAR_DB);
  try {
    await db.execAsync(SCHEMA);
    await db.runAsync(
      "INSERT OR REPLACE INTO sidecar (id, blob) VALUES (1, ?)",
      bytesToBase64(bytes),
    );
  } finally {
    await db.closeAsync();
  }
}
