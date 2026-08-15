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
   * **Increment 5e**: a warm start. Note what it does not carry — a password —
   * which is the point rather than an omission: everything it needs is the wrap
   * in IndexedDB and the database in OPFS.
   */
  | { kind: "resume"; id: number }
  /** Drop the custody wrap, so the next load is a password login again. */
  | { kind: "forget"; id: number }
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
      /**
       * Whether a wrap is waiting in IndexedDB, read without opening it — so the
       * page can offer "resume" or "log in" before the user touches anything.
       */
      custody: { accountId: string; mintedAt: number } | null;
      /**
       * **Increment 5d**: every URL this thread fetched, for the service worker
       * to cache. A page cannot read a worker's resource timing, and the two
       * biggest assets an offline reload needs — the sqlite module and 864 KiB
       * of `.wasm` — are fetched only here.
       */
      resources?: string[];
      /** How long this worker waited for another tab to release the store. */
      waitedMs?: number;
      /** Attempts the VFS install took — see the worker's `installPool`. */
      attempts?: number;
      error?: undefined;
    }
  | { kind: "ready"; error: string };

/**
 * **Increment 5d**: worker → page, when this tab is *not* the one holding the
 * database.
 *
 * A message rather than an error, which is the whole change: 5c and 5e's second
 * tab got `NoModificationAllowedError` out of `installOpfsSAHPoolVfs()` and had
 * nothing to say but "something is broken". A tab that knows it is queued can
 * say so, and a {@link Ready} arrives later if the other tab closes.
 */
export interface Waiting {
  kind: "waiting";
  reason: string;
}

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
  /** What custody the login left behind for a warm start (Increment 5e). */
  custody: { ms: number; extractability: string; storage: string };
}

/**
 * **Increment 5e's done-when**, in one object: what a reload got without a
 * password and without the relay.
 *
 * The three fields that decide it are {@link ResumeSummary.networkCalls} (zero,
 * enforced rather than observed — the worker's `fetch` throws for the duration),
 * {@link ResumeSummary.canary}, and the absence of any Argon2id row in the stage
 * table. Everything else is the cost breakdown of a warm start.
 */
export interface ResumeSummary {
  accountId: string;
  people: { id: string; label: string }[];
  totalMs: number;
  /** IndexedDB open + `AES-GCM` decrypt of the master key and the verifier. */
  unwrapMs: number;
  /** Opening the OPFS database the previous session left behind. */
  openStoreMs: number;
  /** `fetch` calls attempted between the click and the render. Must be 0. */
  networkCalls: number;
  /**
   * Whether a deliberate probe fetch was blocked — the guard's own test, since
   * "no calls were made" and "no counter was installed" read identically.
   */
  guardProven: boolean;
  /** When the wrap was minted — i.e. how long ago the password was last typed. */
  mintedAt: number;
  extractability: string;
  /**
   * The relay record kept at mint time, opened with the key that came out of
   * custody: `plaintext` is a field from inside the envelope, and `inStore` says
   * the OPFS store holds the same row. Null if custody predates a canary.
   */
  canary: {
    table: string;
    id: string;
    plaintext: string;
    bytes: number;
    inStore: boolean;
  } | null;
}

export type Response =
  | { kind: "response"; id: number; ok: true; value: unknown }
  | { kind: "response"; id: number; ok: false; error: string };
