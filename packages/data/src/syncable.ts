import { type HasHistory, type SyncRow, resolveMerge } from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** The generic contract the sync engine drives over one table. Most repos get
 *  it from {@link defineSyncable}; multi-table repos define one per table. */
export interface SyncableRepo<T extends SyncRow> {
  /** The transport table tag for the records this repo owns, e.g. `'pets'`. */
  readonly table: string;
  /** Rows with `updated_at > since`, **tombstones included** so deletes
   *  propagate, ordered by `updated_at`. For the sync collector only. */
  listChangedSince(since: number): Promise<T[]>;
  /** Every live row, oldest first: what anything but the sync collector wants.
   *  Unlike `EntityRepo.list`, not narrowed (unpublished people included). */
  listActive(): Promise<T[]>;
  /** Validate a peer's payload into a row; throws on an invalid one. */
  decode(payload: unknown): T;
  /** Merge a peer's row by whole-row LWW (plus `hasHistory`); write the winner
   *  verbatim, timestamps included, so LWW converges on the writer's clock. */
  upsertFromRemote(remote: T): Promise<void>;
}

/** The value types SQLite (node + expo) round-trips for a bound parameter. */
export type SqlValue = string | number | Uint8Array | null;

/** An `INSERT` and its params from a snake_case column map; shared with the
 *  CRUD insert so both spell columns one way. */
export function insertStatement(
  table: string,
  cols: Record<string, SqlValue>,
): [string, SqlValue[]] {
  const names = Object.keys(cols);
  return [
    `INSERT INTO ${table} (${names.join(", ")})
     VALUES (${names.map(() => "?").join(", ")})`,
    names.map((name) => cols[name]),
  ];
}

/** The `col = ?, …` clause and params for an `UPDATE`, skipping `exclude`. */
export function assignmentClause(
  cols: Record<string, SqlValue>,
  exclude: readonly string[],
): [string, SqlValue[]] {
  const skip = new Set(exclude);
  const names = Object.keys(cols).filter((name) => !skip.has(name));
  return [
    names.map((name) => `${name} = ?`).join(", "),
    names.map((name) => cols[name]),
  ];
}

/** Converts a domain row (camelCase) to and from its table row (snake_case).
 *  The default needs no codec; prefer `json` over a hand-written one. */
export interface RowCodec<T extends SyncRow> {
  /** Domain row → table row (snake_case columns ready to bind). */
  toRow(row: T): Record<string, SqlValue> | Promise<Record<string, SqlValue>>;
  /** Table row (as `SELECT *` returns it) → validated domain row. */
  fromRow(raw: Record<string, unknown>): T | Promise<T>;
}

/** `firstName` → `first_name`; digits and underscores are left alone. */
function toSnakeCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** The default codec: snake_case column names, with booleans as 0/1 and `json`
 *  fields as TEXT. */
function defaultCodec<T extends SyncRow>(
  schema: ParsableSchema<T>,
  fields: readonly string[] | undefined,
  booleans: readonly string[] | undefined,
  json: readonly string[] | undefined,
): RowCodec<T> {
  const names = fields ?? Object.keys(schema.shape ?? {});
  if (names.length === 0) {
    throw new Error(
      "defineSyncable: cannot derive columns — pass a Zod object `schema` " +
        "(so its `.shape` is readable) or an explicit `fields` list, or a `codec`.",
    );
  }
  const bool = new Set(booleans ?? []);
  const structured = new Set(json ?? []);
  return {
    toRow(row) {
      const out: Record<string, SqlValue> = {};
      for (const field of names) {
        const value = (row as Record<string, unknown>)[field];
        out[toSnakeCase(field)] = bool.has(field)
          ? value == null
            ? null
            : value
              ? 1
              : 0
          : structured.has(field)
            ? value == null
              ? null
              : JSON.stringify(value)
            : (value as SqlValue);
      }
      return out;
    },
    fromRow(raw) {
      const obj: Record<string, unknown> = {};
      for (const field of names) {
        const value = raw[toSnakeCase(field)];
        obj[field] = bool.has(field)
          ? value == null
            ? null
            : value !== 0
          : structured.has(field)
            ? parseJsonColumn(value)
            : value;
      }
      return schema.parse(obj);
    },
  };
}

/** Decode a `json` column. NULL becomes `undefined` so the schema's default
 *  applies; malformed text goes to Zod raw, to fail loudly. */
function parseJsonColumn(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** The slice of a Zod object schema this helper relies on. */
export interface ParsableSchema<T> {
  parse(value: unknown): T;
  /** Present on `z.object(...)`; absent on a refined schema (then pass a
   *  `codec`). */
  shape?: Record<string, unknown>;
}

/** The explicit codec, else the default, so `entity-repo` and
 *  {@link defineSyncable} resolve the same one. */
export function resolveCodec<T extends SyncRow>(opts: {
  schema: ParsableSchema<T>;
  fields?: readonly string[];
  booleans?: readonly string[];
  json?: readonly string[];
  codec?: RowCodec<T>;
}): RowCodec<T> {
  return (
    opts.codec ??
    defaultCodec<T>(opts.schema, opts.fields, opts.booleans, opts.json)
  );
}

/** Make a table sync-eligible in one call; the recipe is in the package README
 *  ("How to make an entity sync-eligible"). */
export function defineSyncable<T extends SyncRow>(opts: {
  driver: SqliteDriver;
  /** The transport table tag and the SQL table name (they are the same). */
  table: string;
  /** The `z.object` row schema: validates payloads and names the columns. */
  schema: ParsableSchema<T>;
  /** Override the column list (default: the schema's field names). Rarely
   *  needed. */
  fields?: readonly string[];
  /** Fields stored as 0/1 because SQLite has no boolean type. */
  booleans?: readonly string[];
  /** Fields stored as JSON TEXT; NULL decodes to `undefined`, so the schema's
   *  default decides and a new column needs no backfill. */
  json?: readonly string[];
  /** A bespoke domain↔table mapping, for shapes that differ (encryption). */
  codec?: RowCodec<T>;
  /** Makes an untouched row lose the merge to one a user acted on. Rare: only
   *  for deterministic-id tables (README, "hasHistory"). */
  hasHistory?: HasHistory<T>;
}): SyncableRepo<T> {
  const { driver, table, schema, hasHistory } = opts;
  const codec = resolveCodec<T>(opts);

  return {
    table,

    decode(payload) {
      return schema.parse(payload);
    },

    async listChangedSince(since) {
      const rows = await driver.all<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE updated_at > ? ORDER BY updated_at`,
        [since],
      );
      return Promise.all(rows.map((row) => codec.fromRow(row)));
    },

    async listActive() {
      // Ordered by `created_at`, which every synced table has, so an export of
      // an unchanged store is reproducible byte for byte.
      const rows = await driver.all<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY created_at`,
      );
      return Promise.all(rows.map((row) => codec.fromRow(row)));
    },

    async upsertFromRemote(remote) {
      // Fetch the local row *including* tombstones — the merge must see a
      // delete.
      const existing = await driver.get<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE id = ?`,
        [remote.id],
      );
      if (existing !== undefined) {
        const local = await codec.fromRow(existing);
        // Local wins (or the rows are identical) → nothing to write.
        if (resolveMerge(local, remote, hasHistory) === local) return;
      }

      const cols = await codec.toRow(remote);
      if (existing !== undefined) {
        const [setSql, params] = assignmentClause(cols, ["id"]);
        await driver.run(`UPDATE ${table} SET ${setSql} WHERE id = ?`, [
          ...params,
          remote.id,
        ]);
        return;
      }
      const [insertSql, insertParams] = insertStatement(table, cols);
      await driver.run(insertSql, insertParams);
    },
  };
}
