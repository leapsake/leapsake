import type { SQLiteBindParams, SQLiteDatabase } from "expo-sqlite";
import type { SqliteDriver } from "@leapsake/data";

/**
 * The mobile {@link SqliteDriver}, backed by expo-sqlite. The counterpart to the
 * desktop `node:sqlite` adapter (`apps/desktop/src/main/db/node-sqlite-driver.ts`);
 * `packages/data` itself stays driver-free so it is reused unchanged across both.
 *
 * expo-sqlite is already async, so each method is a thin pass-through — only two
 * shape adjustments are needed: `getFirstAsync` returns `null` (coerced to
 * `undefined` to match the port), and the `unknown[]` params are passed through as
 * positional binds. `transaction` is implemented with manual BEGIN/COMMIT/ROLLBACK
 * to mirror the desktop driver exactly; `core` owns atomicity and never nests
 * transactions, so expo-sqlite's `withTransactionAsync` reentrancy buys nothing.
 */
export function expoSqliteDriver(db: SQLiteDatabase): SqliteDriver {
  return {
    async exec(sql) {
      await db.execAsync(sql);
    },

    async run(sql, params = []) {
      await db.runAsync(sql, params as SQLiteBindParams);
    },

    async all<T>(sql: string, params: unknown[] = []) {
      return db.getAllAsync<T>(sql, params as SQLiteBindParams);
    },

    async get<T>(sql: string, params: unknown[] = []) {
      return (
        (await db.getFirstAsync<T>(sql, params as SQLiteBindParams)) ??
        undefined
      );
    },

    async transaction<T>(fn: () => Promise<T>) {
      await db.execAsync("BEGIN");
      try {
        const result = await fn();
        await db.execAsync("COMMIT");
        return result;
      } catch (error) {
        await db.execAsync("ROLLBACK");
        throw error;
      }
    },
  };
}
