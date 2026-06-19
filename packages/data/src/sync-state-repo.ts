import type { SqliteDriver } from "./driver.js";

/**
 * Durable persistence for the {@link SyncEngine}'s two watermarks, so a fresh
 * engine on the same database resumes exactly where it left off instead of
 * re-pushing or re-pulling from zero (plans/encryption/sync.md).
 *
 * It is backed by the device-local `sync_state` table (migration 13), a plain
 * key/value store. That table carries none of the sync substrate and is *never*
 * registered as a {@link SyncableRepo} — these marks are per-device and must not
 * replicate (model.md §3), exactly like the `content_key`/`key_wrap` tables.
 *
 * - `push_hwm` — the epoch-ms high-water mark of rows already sealed and pushed.
 * - `pull_cursor` — the transport's opaque delivery cursor already consumed.
 *
 * A missing row reads as `0`, which is the documented floor for both:
 * `push(0)` collects every local row and `pull(0)` returns the whole log (see
 * `sync-transport.ts`, where transport sequences start at 1).
 */
export interface SyncStateRepo {
  getPushHwm(): Promise<number>;
  setPushHwm(value: number): Promise<void>;
  getPullCursor(): Promise<number>;
  setPullCursor(value: number): Promise<void>;
}

const PUSH_HWM = "push_hwm";
const PULL_CURSOR = "pull_cursor";

export function createSyncStateRepo(driver: SqliteDriver): SyncStateRepo {
  async function read(key: string): Promise<number> {
    const row = await driver.get<{ value: number }>(
      "SELECT value FROM sync_state WHERE key = ?",
      [key],
    );
    return row?.value ?? 0;
  }

  async function write(key: string, value: number): Promise<void> {
    // Upsert — portable across node:sqlite and expo-sqlite (matches the
    // partial-index/portability constraint the migrations are written to).
    await driver.run(
      `INSERT INTO sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [key, value, value],
    );
  }

  return {
    getPushHwm: () => read(PUSH_HWM),
    setPushHwm: (value) => write(PUSH_HWM, value),
    getPullCursor: () => read(PULL_CURSOR),
    setPullCursor: (value) => write(PULL_CURSOR, value),
  };
}
