import type { SQLiteBindParams, SQLiteDatabase } from "expo-sqlite";
import type { SqliteDriver } from "@leapsake/data";

/**
 * The mobile {@link SqliteDriver}, backed by expo-sqlite. The counterpart to the
 * desktop `node:sqlite` adapter (`apps/desktop/src/main/db/node-sqlite-driver.ts`);
 * `packages/data` itself stays driver-free so it is reused unchanged across both.
 *
 * expo-sqlite is already async, so each method is a thin pass-through around the
 * close guard below — only two shape adjustments are needed: `getFirstAsync` returns `null` (coerced to
 * `undefined` to match the port), and the `unknown[]` params are passed through as
 * positional binds. `transaction` is implemented with manual BEGIN/COMMIT/ROLLBACK
 * to mirror the desktop driver exactly; `core` owns atomicity and never nests
 * transactions, so expo-sqlite's `withTransactionAsync` reentrancy buys nothing.
 */
/** What a call started after `close()` rejects with. */
export const STORE_CLOSED = "the store is closed";

export function expoSqliteDriver(db: SQLiteDatabase): SqliteDriver {
  // Closing under an in-flight query frees the native statement beneath it: Android rejects
  // the next `NativeStatement` call, iOS segfaults on the freed pointer.
  let closing: Promise<void> | null = null;
  let closed = false;
  let inFlight = 0;
  let drained: (() => void) | null = null;

  // A close in progress still admits work while anything is in flight: the calls a running
  // `transaction` makes are that work, and refusing them would roll back what it had done.
  const whileOpen = async <T>(work: () => Promise<T>): Promise<T> => {
    if (closed || (closing !== null && inFlight === 0)) {
      throw new Error(STORE_CLOSED);
    }
    inFlight += 1;
    try {
      return await work();
    } finally {
      inFlight -= 1;
      if (inFlight === 0 && drained !== null) {
        const wake = drained;
        drained = null;
        wake();
      }
    }
  };

  return {
    async exec(sql) {
      await whileOpen(() => db.execAsync(sql));
    },

    async run(sql, params = []) {
      await whileOpen(() => db.runAsync(sql, params as SQLiteBindParams));
    },

    async all<T>(sql: string, params: unknown[] = []) {
      return whileOpen(() =>
        db.getAllAsync<T>(sql, params as SQLiteBindParams),
      );
    },

    async get<T>(sql: string, params: unknown[] = []) {
      return whileOpen(
        async () =>
          (await db.getFirstAsync<T>(sql, params as SQLiteBindParams)) ??
          undefined,
      );
    },

    async transaction<T>(fn: () => Promise<T>) {
      return whileOpen(async () => {
        await db.execAsync("BEGIN");
        try {
          const result = await fn();
          await db.execAsync("COMMIT");
          return result;
        } catch (error) {
          await db.execAsync("ROLLBACK");
          throw error;
        }
      });
    },

    close() {
      // Idempotent, and it waits: every caller of close() gets the same drain.
      closing ??= (async () => {
        if (inFlight > 0) {
          await new Promise<void>((resolve) => {
            drained = resolve;
          });
        }
        await db.closeAsync();
        closed = true;
      })();
      return closing;
    },
  };
}
