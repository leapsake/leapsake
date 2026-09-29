import * as SQLite from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

// Serialized per file: one call closing while another queries frees the
// native handle beneath it, a rejected statement on Android or a SIGSEGV.
const queues = new Map<string, Promise<unknown>>();

export function withDatabase<T>(
  name: string,
  work: (db: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const run = (queues.get(name) ?? Promise.resolve()).then(async () => {
    // Own connection: a shared one would close for everybody in the `finally`.
    const db = await SQLite.openDatabaseAsync(name, { useNewConnection: true });
    try {
      return await work(db);
    } finally {
      await db.closeAsync();
    }
  });
  queues.set(
    name,
    run.catch(() => undefined),
  );
  return run;
}
