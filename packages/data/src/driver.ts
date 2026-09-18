/** The async SQLite port the data layer is written against; node:sqlite and
 *  expo-sqlite both satisfy it. */
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
  /** Release the handle, so a factory reset can delete the file (Windows
   *  refuses to unlink an open one). Optional: most drivers stay open. */
  close?(): Promise<void>;
}
