import type { SqliteDriver } from "./driver.js";

/** A single ordered, forward-only schema change. */
export interface Migration {
  version: number;
  up(driver: SqliteDriver): Promise<void>;
}

/**
 * The ordered migration list. Append new migrations with the next integer
 * version; never edit or reorder existing ones. Portable SQL only, so the same
 * migrations run on better-sqlite3 (desktop) and expo-sqlite (mobile).
 */
export const migrations: Migration[] = [
  {
    version: 1,
    async up(driver) {
      await driver.exec(`
        CREATE TABLE people (
          id         TEXT    PRIMARY KEY,
          first_name TEXT    NOT NULL,
          last_name  TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
      `);
    },
  },
];

/**
 * Apply any migrations newer than the database's current `user_version`, each
 * inside a transaction, then bump `user_version`. Cheap hand-rolled runner in
 * place of a migration library (reboot-plan.md §4.5).
 */
export async function runMigrations(
  driver: SqliteDriver,
  steps: Migration[] = migrations,
): Promise<void> {
  const row = await driver.get<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;

  const pending = steps
    .filter((step) => step.version > current)
    .toSorted((a, b) => a.version - b.version);

  for (const step of pending) {
    await driver.transaction(async () => {
      await step.up(driver);
      // PRAGMA user_version does not accept bound parameters; the version is a
      // trusted integer from our own migration list, so interpolation is safe.
      await driver.exec(`PRAGMA user_version = ${step.version}`);
    });
  }
}
