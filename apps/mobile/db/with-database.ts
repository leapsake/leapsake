import * as SQLite from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Open `name`, do one piece of work, close it — and never let two of those overlap on the
 * same file.
 *
 * **Why the queue.** `doors.ts` and `roster-storage.ts` open a database per call and close it
 * in a `finally`. Two concurrent calls on one file — the recovery gate reading the password
 * door and the phrase door, say — leave one closing while the other is mid-query, and
 * expo-sqlite frees the native handle beneath it: `NativeStatement … has been rejected` on
 * Android, a SIGSEGV on the JS thread when the free lands at the wrong instant (hosted
 * runners, 2026-09-20). The store's own driver holds this off with a drain
 * (`expo-sqlite-driver.ts`); these short-lived handles need the same protection, and
 * serializing them is the cheapest form of it.
 *
 * Failures do not poison the queue: the next caller runs regardless.
 */
const queues = new Map<string, Promise<unknown>>();

export function withDatabase<T>(
  name: string,
  work: (db: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const run = (queues.get(name) ?? Promise.resolve()).then(async () => {
    // Own connection: a shared one closes for everybody when this `finally` runs.
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
