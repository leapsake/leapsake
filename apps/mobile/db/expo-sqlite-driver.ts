import type { SQLiteBindParams, SQLiteDatabase } from "expo-sqlite";
import { type SqliteDriver, serialTransaction } from "@leapsake/data";

/** What a call started after `close()` rejects with. */
export const STORE_CLOSED = "the store is closed";

export function expoSqliteDriver(db: SQLiteDatabase): SqliteDriver {
  // Closing under an in-flight query frees the native statement: Android
  // rejects the next call, iOS segfaults on the freed pointer.
  let closing: Promise<void> | null = null;
  let closed = false;
  let inFlight = 0;
  let drained: (() => void) | null = null;
  const transaction = serialTransaction((sql) => db.execAsync(sql));

  // A closing driver still admits in-flight work: a running `transaction`'s
  // own calls, which refusing would roll back.
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

    transaction: (fn) => whileOpen(() => transaction(fn)),

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
