import * as SQLite from "expo-sqlite";
import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";
import { storeDir } from "@leapsake/store-layout";
import { withDatabase } from "./with-database";

/**
 * One account's two db-key doors, the password and the recovery phrase, in an
 * unencrypted database beside its store (the app's README).
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
  /** Delete this account's doors; none having been written is a success. */
  destroy(): Promise<void>;
}

/** One row per door, keyed by which door it is. */
const SCHEMA =
  "CREATE TABLE IF NOT EXISTS door (kind TEXT PRIMARY KEY, blob TEXT NOT NULL)";

/** Where one account's doors live, beside its store. */
export function doorsPath(slot: string): string {
  return `${storeDir(slot)}/doors.db`;
}

/**
 * The doors for the slot `storePath` names the store with. Each call opens and
 * closes its own connection, so a later delete can always take the file.
 */
export function accountDoors(slot: string): AccountDoors {
  const name = doorsPath(slot);

  async function readBlob(kind: string): Promise<Uint8Array | undefined> {
    return withDatabase(name, async (db) => {
      await db.execAsync(SCHEMA);
      const row = await db.getFirstAsync<{ blob: string }>(
        "SELECT blob FROM door WHERE kind = ?",
        kind,
      );
      return row === null ? undefined : base64ToBytes(row.blob);
    });
  }

  async function writeBlob(kind: string, bytes: Uint8Array): Promise<void> {
    await withDatabase(name, async (db) => {
      await db.execAsync(SCHEMA);
      await db.runAsync(
        "INSERT OR REPLACE INTO door (kind, blob) VALUES (?, ?)",
        kind,
        bytesToBase64(bytes),
      );
    });
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
        // Never written: `deleteDatabaseAsync` throws for a missing file.
      }
    },
  };
}
