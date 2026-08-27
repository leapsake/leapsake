/**
 * The async SQLite port the data layer is written against.
 *
 * node:sqlite (desktop) is synchronous and expo-sqlite (mobile, V2) is
 * asynchronous; both satisfy this async interface, so the repository and
 * migration runner are written once and ported, not rewritten. See
 * (see this package's README → *The `SqliteDriver` port*).
 */
export interface SqliteDriver {
  /** Execute one or more statements with no parameters and no result. */
  exec(sql: string): Promise<void>;
  /** Execute a single parameterized statement that returns no rows. */
  run(sql: string, params?: unknown[]): Promise<void>;
  /** Execute a query and return all matching rows. */
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Execute a query and return the first row, or undefined. */
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Run `fn` inside a transaction, committing on success or rolling back. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Release the underlying database handle, if the backing engine holds one.
   * Optional because most callers keep a driver open for the process lifetime;
   * a **factory reset** needs it so the file is unlocked before it is deleted
   * (Windows refuses to unlink an open SQLite file). A driver with no handle to
   * free (e.g. an in-memory test driver) may leave it undefined.
   */
  close?(): Promise<void>;
}
