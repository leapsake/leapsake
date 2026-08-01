import type { HasHistory, SyncRow } from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type ParsableSchema,
  type RowCodec,
  type SyncableRepo,
  assignmentClause,
  defineSyncable,
  insertStatement,
  resolveCodec,
} from "./syncable.js";

/**
 * The standard CRUD surface a plain domain entity gets for free, on top of the
 * {@link SyncableRepo} contract. The column mapping (snake↔camel, booleans,
 * encryption) lives in exactly one place — the {@link RowCodec} — and the SQL is
 * generated from it, so there is no per-entity `XRow` interface, `toX` mapper, or
 * hand-written `INSERT`/`UPDATE` column list.
 *
 * A repo composes this by spreading {@link createEntityRepo} and overriding the
 * two methods that own entity-specific input handling: `create` (parse the create
 * input, apply defaults, mint id/timestamps, then call {@link EntityRepo.insert})
 * and `update` (parse the patch, then call {@link EntityRepo.update}).
 */
export interface EntityRepo<T extends SyncRow> extends SyncableRepo<T> {
  /** Persist an already-assembled domain row (id + timestamps set). */
  insert(row: T): Promise<T>;
  /** Fetch by id, excluding soft-deleted rows. */
  get(id: string): Promise<T | undefined>;
  /** Like {@link get} but returns soft-deleted rows too (a merge must see them). */
  getIncludingDeleted(id: string): Promise<T | undefined>;
  /** Every active row, optionally ordered by the configured `orderBy`. */
  list(): Promise<T[]>;
  /**
   * Active rows matching a caller-supplied `WHERE` fragment (raw snake_case SQL,
   * `?`-bound via `params`), decoded through the same codec. The escape hatch for
   * the scoped reads a generic `list()` can't express — owner-scoped contact
   * methods, subject-scoped milestones — without re-deriving a per-row mapper.
   */
  listWhere(query: {
    where: string;
    params: readonly unknown[];
    orderBy?: string;
  }): Promise<T[]>;
  /**
   * Merge a patch onto the active row, bump `updated_at`, and re-validate the
   * whole row (so cross-field rules still hold). Returns the merged row, or
   * undefined if no active row exists.
   */
  update(id: string, patch: Partial<T>): Promise<T | undefined>;
  /** Soft-delete: set `deleted_at` and a strictly-newer `updated_at`. */
  softDelete(id: string): Promise<void>;
}

/**
 * Soft-delete every active row matching a `WHERE` fragment (raw snake_case SQL,
 * `?`-bound via `params`). `MAX(?, updated_at + 1)` makes each tombstone strictly
 * out-rank the row's current version on every device, so a delete landing in the
 * row's creation millisecond (as a merge does to its loser) can't tie on
 * `updated_at` and be resurrected by whole-row LWW's tiebreak.
 *
 * This is the single home for the soft-delete tombstone — **the one way any repo
 * sets `deleted_at`**, whether the delete is by id ({@link softDeleteRow}), by a
 * cascade predicate (a host entity's `removeAllFor…`), or the merge re-points
 * that share the same `MAX` idiom. New code should reach for one of these rather
 * than hand-writing the `UPDATE`, so a future tombstone tweak lands in one place.
 */
export function softDeleteWhere(
  driver: SqliteDriver,
  table: string,
  where: string,
  params: readonly unknown[],
): Promise<void> {
  const now = Date.now();
  return driver.run(
    `UPDATE ${table} SET deleted_at = ?, updated_at = MAX(?, updated_at + 1)
       WHERE (${where}) AND deleted_at IS NULL`,
    [now, now, ...params],
  );
}

/** Soft-delete a single row by id — the by-id case of {@link softDeleteWhere}. */
export function softDeleteRow(
  driver: SqliteDriver,
  table: string,
  id: string,
): Promise<void> {
  return softDeleteWhere(driver, table, "id = ?", [id]);
}

/**
 * Build the standard CRUD + {@link SyncableRepo} surface for a domain entity over
 * the async {@link SqliteDriver} port. Reuses the same {@link RowCodec} for the
 * local CRUD path and the sync path (it resolves the codec once and hands it to
 * {@link defineSyncable}), so an entity's columns are spelled exactly once — in
 * its Zod schema. Pass an explicit `codec` only when the on-wire shape differs
 * from the on-disk shape (encrypted fields — see `milestones-repo.ts`).
 */
export function createEntityRepo<T extends SyncRow>(opts: {
  driver: SqliteDriver;
  /** The transport table tag and the SQL table name (they are the same). */
  table: string;
  /** The `z.object` raw-row schema — validates rows and names the columns. */
  schema: ParsableSchema<T>;
  /** `list()` ORDER BY clause (raw SQL, snake_case), e.g. "last_name, first_name". */
  orderBy?: string;
  /** Override the column list (default: the schema's field names). Rarely needed. */
  fields?: readonly string[];
  /** Fields stored as 0/1 because SQLite has no boolean type. */
  booleans?: readonly string[];
  /** A bespoke domain↔table mapping; only for shapes that differ (encryption). */
  codec?: RowCodec<T>;
  /** Narrow the merge so an untouched row never wins — see {@link defineSyncable}. */
  hasHistory?: HasHistory<T>;
}): EntityRepo<T> {
  const { driver, table, schema, orderBy } = opts;
  const codec = resolveCodec<T>(opts);
  // Hand the *same* resolved codec to the sync surface so CRUD and sync map
  // columns identically (and we never build the default codec twice).
  const syncable = defineSyncable<T>({ ...opts, codec });

  async function readOne(
    id: string,
    activeOnly: boolean,
  ): Promise<T | undefined> {
    const row = await driver.get<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id = ?${activeOnly ? " AND deleted_at IS NULL" : ""}`,
      [id],
    );
    return row === undefined ? undefined : codec.fromRow(row);
  }

  const get = (id: string): Promise<T | undefined> => readOne(id, true);

  async function listWhere(query: {
    where: string;
    params: readonly unknown[];
    orderBy?: string;
  }): Promise<T[]> {
    const rows = await driver.all<Record<string, unknown>>(
      `SELECT * FROM ${table}
        WHERE deleted_at IS NULL AND (${query.where})${
          query.orderBy ? ` ORDER BY ${query.orderBy}` : ""
        }`,
      [...query.params],
    );
    return Promise.all(rows.map((row) => codec.fromRow(row)));
  }

  return {
    ...syncable,
    get,
    getIncludingDeleted: (id) => readOne(id, false),
    listWhere,

    async insert(row) {
      const validated = schema.parse(row);
      const cols = await codec.toRow(validated);
      const [sql, params] = insertStatement(table, cols);
      await driver.run(sql, params);
      return validated;
    },

    list: () => listWhere({ where: "1 = 1", params: [], orderBy }),

    async update(id, patch) {
      const existing = await get(id);
      if (existing === undefined) return undefined;
      // Re-validate the whole merged row so cross-field rules (e.g. milestone
      // day⇒month) still hold after a partial update. `created_at` is never
      // reassigned (excluded below) so it stays the original.
      const updated = schema.parse({
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      });
      const cols = await codec.toRow(updated);
      const [setSql, params] = assignmentClause(cols, ["id", "created_at"]);
      await driver.run(
        `UPDATE ${table} SET ${setSql} WHERE id = ? AND deleted_at IS NULL`,
        [...params, id],
      );
      return updated;
    },

    softDelete: (id) => softDeleteRow(driver, table, id),
  };
}
