import * as SQLite from "expo-sqlite";
import type { RosterStorage } from "@leapsake/store-layout";
import { withDatabase } from "./with-database";

/**
 * The mobile {@link RosterStorage}: the account roster (`model.md` §7.4) in a
 * **separate, unencrypted** expo-sqlite database — the same shape, and for the same
 * reason, as the db-key sidecars next door (`sidecars.ts`). Mobile has no
 * general filesystem dependency, so where desktop writes `accounts.json`, this
 * writes one row.
 *
 * Unencrypted is not an oversight: the roster must be readable *before* any store
 * is opened — you cannot enumerate accounts from inside files you cannot decrypt —
 * so it necessarily leaks the usernames on this device. The design accepts that; a
 * login picker has to render.
 *
 * It must never be the store database, and it is device-local — never synced.
 */
const ROSTER_DB = "leapsake-roster.db";
const SCHEMA =
  "CREATE TABLE IF NOT EXISTS roster (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)";

/**
 * Delete the roster database outright — the mobile half of a **factory reset**,
 * where forgetting which accounts existed is the point. Each read/write opens its
 * own short-lived connection and closes it, so nothing holds this DB open.
 */
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
