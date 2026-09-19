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

/** Standard CRUD over the {@link SyncableRepo} contract, with SQL generated
 *  from the codec. Repos override `create` and `update` for their input. */
export interface EntityRepo<T extends SyncRow> extends SyncableRepo<T> {
  /** Persist an already-assembled domain row (id + timestamps set). */
  insert(row: T): Promise<T>;
  /** Fetch by id, excluding soft-deleted rows. */
  get(id: string): Promise<T | undefined>;
  /** Like {@link get} but returns soft-deleted rows too (a merge must see
   *  them). */
  getIncludingDeleted(id: string): Promise<T | undefined>;
  /** Every active row, in `orderBy` order and narrowed by `listOnly`. The
   *  unnarrowed read is {@link SyncableRepo.listActive}. */
  list(): Promise<T[]>;
  /** Active rows matching a raw snake_case `WHERE` with bound `params`, for
   *  scoped reads `list()` cannot express. */
  listWhere(query: {
    where: string;
    params: readonly unknown[];
    orderBy?: string;
  }): Promise<T[]>;
  /** Merge a patch, bump `updated_at` and re-validate the whole row; undefined
   *  when no active row exists. */
  update(id: string, patch: Partial<T>): Promise<T | undefined>;
  /** Soft-delete: set `deleted_at` and a strictly-newer `updated_at`. */
  softDelete(id: string): Promise<void>;
}

/** Tombstone every active row matching a `WHERE`: the one way any repo sets
 *  `deleted_at`, using the README's `MAX(?, updated_at + 1)` rule. */
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

/** Soft-delete one row by id: the by-id case of {@link softDeleteWhere}. */
export function softDeleteRow(
  driver: SqliteDriver,
  table: string,
  id: string,
): Promise<void> {
  return softDeleteWhere(driver, table, "id = ?", [id]);
}

/** Build the CRUD and sync surface for an entity, sharing one codec so its
 *  columns are spelled once, in its Zod schema. */
export function createEntityRepo<T extends SyncRow>(opts: {
  driver: SqliteDriver;
  /** The transport table tag and the SQL table name (they are the same). */
  table: string;
  /** The `z.object` raw-row schema — validates rows and names the columns. */
  schema: ParsableSchema<T>;
  /** `list()` ORDER BY clause (raw SQL, snake_case), e.g. "last_name,
   *  first_name". */
  orderBy?: string;
  /** A `WHERE` fragment only `list()` applies: how the catalog leaves out
   *  unpublished entities. `get`, `listWhere` and sync still see them. */
  listOnly?: string;
  /** Override the column list (default: the schema's field names). Rarely
   *  needed. */
  fields?: readonly string[];
  /** Fields stored as 0/1 because SQLite has no boolean type. */
  booleans?: readonly string[];
  /** Fields stored as JSON TEXT because SQLite has no array or object type. */
  json?: readonly string[];
  /** A bespoke domain↔table mapping, for shapes that differ (encryption). */
  codec?: RowCodec<T>;
  /** Narrow the merge so an untouched row never wins — see
   *  {@link defineSyncable}. */
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

    list: () =>
      listWhere({ where: opts.listOnly ?? "1 = 1", params: [], orderBy }),

    async update(id, patch) {
      const existing = await get(id);
      if (existing === undefined) return undefined;
      // Re-validate the merged row so cross-field rules hold; `created_at` is
      // never reassigned.
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
