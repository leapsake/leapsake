import * as SQLite from "expo-sqlite";
import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";
import { storeDir } from "@leapsake/store-layout";

/**
 * The mobile **db-key doors** (encryption `model.md` §6, §7.5 Phase 0.5): the two
 * blobs that let a user back into their encrypted store when this device's enclave
 * key is lost. Both hold the same whole-DB key, sealed under a different door:
 *
 * - **password** — `seal(db-key, KEK)`, the primary way in. Someone who remembers
 *   their password should never be sent hunting for 24 words.
 * - **recovery** — `wrap(db-key, recoveryKey)`, the forgot-password backstop.
 *
 * Desktop keeps these as files named after the store (`<dbPath>.password`,
 * `<dbPath>.recovery` — `main/db/sidecars.ts`). Mobile has no general filesystem
 * dependency, so they live in a **separate, unencrypted** expo-sqlite database —
 * opened with no `PRAGMA key`, so it is readable without the (now-missing) enclave
 * key. Storing them unencrypted is safe: each blob is opaque ciphertext under a
 * full 256-bit key.
 *
 * ### Why they are per-account
 *
 * They live **inside the account's own store directory** — `stores/<accountId>/doors.db`
 * — so a door can only be reached through the account that owns it. Until custody
 * slice 7b they were one device-scoped database at a fixed name, which made "forget
 * this account" drop *every* account's doors: silent at the time, and surfacing only
 * much later, when a wiped keychain left the surviving account with no way back in.
 * Scoping by path rather than by a `WHERE` is deliberate — a call site can forget a
 * predicate, but it cannot forget a path.
 *
 * The doors database must never be the store database (that is the thing we cannot
 * open without the key), and it is device-local — never synced, because each device
 * seals its *own* db-key.
 */
export interface AccountDoors {
  /** Read the password door, or `undefined` if this device has none. */
  readPassword(): Promise<Uint8Array | undefined>;
  /** Write (or replace) the password door. */
  writePassword(bytes: Uint8Array): Promise<void>;
  /** Read the recovery-phrase door, or `undefined` if it was never written. */
  readRecovery(): Promise<Uint8Array | undefined>;
  /** Write (or replace) the recovery-phrase door. */
  writeRecovery(bytes: Uint8Array): Promise<void>;
  /**
   * Delete this account's doors outright — the file half of **forget account**, and
   * of a factory reset, where losing both doors is the point. Tolerant of doors that
   * were never written: "there were none" is a success for every caller.
   */
  destroy(): Promise<void>;
}

/** One row per door, keyed by which door it is. */
const SCHEMA =
  "CREATE TABLE IF NOT EXISTS door (kind TEXT PRIMARY KEY, blob TEXT NOT NULL)";

/**
 * Where one account's doors live, relative to expo-sqlite's database directory —
 * beside its store rather than beside the app, which is the whole of slice 7b.
 */
export function doorsPath(slot: string): string {
  return `${storeDir(slot)}/doors.db`;
}

/**
 * The two doors for one account (the Unauthenticated slot may be named too; it never has any).
 *
 * `slot` is the account id — the same slot `storePath` names the store with, so the
 * doors and the store they open are created and destroyed together. Each call opens
 * a short-lived connection and closes it, so nothing holds the database open and a
 * later delete can always take the file.
 */
export function accountDoors(slot: string): AccountDoors {
  const name = doorsPath(slot);

  async function readBlob(kind: string): Promise<Uint8Array | undefined> {
    const db = await SQLite.openDatabaseAsync(name);
    try {
      await db.execAsync(SCHEMA);
      const row = await db.getFirstAsync<{ blob: string }>(
        "SELECT blob FROM door WHERE kind = ?",
        kind,
      );
      return row === null ? undefined : base64ToBytes(row.blob);
    } finally {
      await db.closeAsync();
    }
  }

  async function writeBlob(kind: string, bytes: Uint8Array): Promise<void> {
    const db = await SQLite.openDatabaseAsync(name);
    try {
      await db.execAsync(SCHEMA);
      await db.runAsync(
        "INSERT OR REPLACE INTO door (kind, blob) VALUES (?, ?)",
        kind,
        bytesToBase64(bytes),
      );
    } finally {
      await db.closeAsync();
    }
  }

  return {
    readPassword: () => readBlob("password"),
    writePassword: (bytes) => writeBlob("password", bytes),
    readRecovery: () => readBlob("recovery"),
    writeRecovery: (bytes) => writeBlob("recovery", bytes),
    async destroy() {
      try {
        await SQLite.deleteDatabaseAsync(name);
      } catch {
        // Never written. `deleteDatabaseAsync` throws rather than shrugging at a
        // missing file, and there is nothing here worth failing a forget over.
      }
    },
  };
}
