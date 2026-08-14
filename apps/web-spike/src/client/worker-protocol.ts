/**
 * The three message shapes between the page and `core-worker.ts` — the entire
 * contract of Increment 5c's thread boundary, and short enough to read in one
 * sitting, which is the point.
 *
 * Everything crossing it is structured-cloneable by construction: `CoreApi`
 * arguments and results are plain data (view models, rows, ids) because they
 * were already crossing desktop's `ipcRenderer` boundary as JSON. Errors are the
 * one exception and travel as strings — see the worker's `catch`.
 */

/** Page → worker. `id` correlates the {@link Response}; the page allocates it. */
export type Request =
  | { kind: "login"; id: number; username: string; password: string }
  /**
   * One `CoreApi` call, addressed by path: `["gifts", "ideas", "list"]` is
   * `core.gifts.ideas.list()`. A path rather than a method name because the API
   * is three levels deep in places, and a flat name table would be a list to
   * maintain — the proxy walks whatever the caller wrote.
   */
  | { kind: "call"; id: number; path: readonly string[]; args: unknown[] }
  | { kind: "wipe"; id: number };

/** Worker → page, once, when sqlite-wasm and the OPFS pool are up (or are not). */
export type Ready =
  | {
      kind: "ready";
      initMs: number;
      vfsMs: number;
      libVersion: string;
      vfsName: string;
      /** What OPFS already holds — a previous run's database, on a reload. */
      files: string[];
      error?: undefined;
    }
  | { kind: "ready"; error: string };

/**
 * Worker → page, unsolicited: one row of the login's stage table as it happens.
 *
 * These are the interactivity claim in its most direct form. 5b's page had to
 * `await paint()` between stages to get a row on screen before the next
 * synchronous block, and even then it painted *between* stages rather than
 * during them. Here the main thread is free the whole time, so a row appears
 * the moment the worker sends it and nothing has to yield to anything.
 */
export interface Stage {
  kind: "stage";
  label: string;
  ms: number | null;
  detail: string;
}

/** What a login produced, once the worker has a store, a key and a `core`. */
export interface Summary {
  people: { id: string; label: string }[];
  totalMs: number;
  argon2Ms: number;
  /** Worst event-loop stall on the **worker** thread, spanning the whole login. */
  workerLagMs: number;
  /** The same probe's reading across Argon2id alone, from `bootstrap.ts`. */
  argon2LagMs: number;
  cursorBefore: number;
  cursorAfter: number;
  applied: number;
  records: number;
  /** Whether the OPFS database already existed — i.e. this was a reload. */
  reusedStore: boolean;
}

export type Response =
  | { kind: "response"; id: number; ok: true; value: unknown }
  | { kind: "response"; id: number; ok: false; error: string };
