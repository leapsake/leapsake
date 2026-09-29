import * as SQLite from "expo-sqlite";
import type { RosterStorage } from "@leapsake/store-layout";
import { withDatabase } from "./with-database";

// The account roster as one row in its own unencrypted database, readable
// before any store opens (the app's README).
const ROSTER_DB = "leapsake-roster.db";
const SCHEMA =
  "CREATE TABLE IF NOT EXISTS roster (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)";

/** Delete the roster database outright, for a factory reset. */
export async function deleteAccountRoster(): Promise<void> {
  await SQLite.deleteDatabaseAsync(ROSTER_DB);
}

export function sqliteRosterStorage(): RosterStorage {
  return {
    async read() {
      return withDatabase(ROSTER_DB, async (db) => {
        await db.execAsync(SCHEMA);
        const row = await db.getFirstAsync<{ json: string }>(
          "SELECT json FROM roster WHERE id = 1",
        );
        return row === null ? undefined : row.json;
      });
    },

    async write(text) {
      await withDatabase(ROSTER_DB, async (db) => {
        await db.execAsync(SCHEMA);
        await db.runAsync(
          "INSERT OR REPLACE INTO roster (id, json) VALUES (1, ?)",
          text,
        );
      });
    },
  };
}
