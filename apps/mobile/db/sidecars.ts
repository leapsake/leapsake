import * as SQLite from "expo-sqlite";
import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";

/**
 * The mobile **db-key sidecars** (encryption `model.md` §6, §7.5 Phase 0.5): the
 * two blobs that let a user back into their encrypted database when this device's
 * enclave key is lost. Both hold the same whole-DB key, sealed under a different
 * door:
 *
 * - **password** — `seal(db-key, KEK)`, the primary way in. Someone who remembers
 *   their password should never be sent hunting for 24 words.
 * - **recovery** — `wrap(db-key, recoveryKey)`, the forgot-password backstop.
 *
 * Desktop keeps these as plaintext files beside the DB (`main/db/sidecars.ts`); on
 * mobile, where we have no general filesystem dependency, they live in a
 * **separate, unencrypted** expo-sqlite database — opened with no `PRAGMA key`, so
 * it is readable without the (now-missing) enclave key. Storing them unencrypted is
 * safe: each blob is opaque ciphertext under a full 256-bit key.
 *
 * It must never be the same database as `leapsake.db` (that one is the thing we
 * can't open without the key), and it is intentionally device-local — never synced,
 * because each device seals its *own* db-key.
 *
 * The two doors are separate tables rather than two rows: the original schema
 * pinned `id = 1` with a CHECK, and a second table needs no migration of a file
 * that must stay readable to be useful.
 */
const SIDECAR_DB = "leapsake-recovery.db";

/** One row, one blob — the shape both doors use. */
const schemaFor = (table: string) =>
  `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY CHECK (id = 1), blob TEXT NOT NULL)`;

const RECOVERY_TABLE = "sidecar";
const PASSWORD_TABLE = "password_sidecar";

async function readBlob(table: string): Promise<Uint8Array | undefined> {
  const db = await SQLite.openDatabaseAsync(SIDECAR_DB);
  try {
    await db.execAsync(schemaFor(table));
    const row = await db.getFirstAsync<{ blob: string }>(
      `SELECT blob FROM ${table} WHERE id = 1`,
    );
    return row === null ? undefined : base64ToBytes(row.blob);
  } finally {
    await db.closeAsync();
  }
}

async function writeBlob(table: string, bytes: Uint8Array): Promise<void> {
  const db = await SQLite.openDatabaseAsync(SIDECAR_DB);
  try {
    await db.execAsync(schemaFor(table));
    await db.runAsync(
      `INSERT OR REPLACE INTO ${table} (id, blob) VALUES (1, ?)`,
      bytesToBase64(bytes),
    );
  } finally {
    await db.closeAsync();
  }
}

/** Read the recovery-phrase door, or `undefined` if it was never written. */
export function readRecoverySidecar(): Promise<Uint8Array | undefined> {
  return readBlob(RECOVERY_TABLE);
}

/** Write (or replace) the recovery-phrase door. */
export function writeRecoverySidecar(bytes: Uint8Array): Promise<void> {
  return writeBlob(RECOVERY_TABLE, bytes);
}

/** Read the password door, or `undefined` if this device has none. */
export function readPasswordSidecar(): Promise<Uint8Array | undefined> {
  return readBlob(PASSWORD_TABLE);
}

/** Write (or replace) the password door. */
export function writePasswordSidecar(bytes: Uint8Array): Promise<void> {
  return writeBlob(PASSWORD_TABLE, bytes);
}

/**
 * Delete the sidecar database outright — the mobile half of a **factory reset**,
 * where losing both doors is intended (the whole store is being erased). Dropping
 * the file takes both tables with it, so neither door can outlive the key it
 * opens. Each read/write opens its own short-lived connection and closes it, so
 * nothing holds this DB open; a fresh launch recreates it.
 */
export async function deleteSidecars(): Promise<void> {
  await SQLite.deleteDatabaseAsync(SIDECAR_DB);
}
