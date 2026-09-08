import { type HasHistory, type SyncRow, resolveMerge } from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/**
 * A repository the {@link SyncEngine} can drive. It is the *generic* contract
 * the engine needs over any one table — collect locally-changed rows, decode a
 * pulled JSON payload, and apply a peer's row via the merge — so the engine
 * stays schema-agnostic and one more synced entity is just one more entry in the
 * registry (plans/status.md, the "extend beyond `people`" step).
 *
 * Most domain repositories implement this via {@link defineSyncable} (see the
 * recipe below); a repo that owns more than one table (tags + taggings, the
 * three contact-method tables) defines one {@link SyncableRepo} per table.
 *
 * `getIncludingDeleted` is deliberately *not* here: it is the repo's own
 * internal merge-fetch detail, used inside {@link upsertFromRemote}.
 */
export interface SyncableRepo<T extends SyncRow> {
  /** The transport table tag for the records this repo owns, e.g. `'pets'`. */
  readonly table: string;
  /**
   * All rows with `updated_at > since`, **including tombstones**, ordered by
   * `updated_at` — the sync collector's source of locally-changed records (so
   * deletes propagate).
   */
  listChangedSince(since: number): Promise<T[]>;
  /**
   * Every **live** row, oldest first — {@link listChangedSince}'s counterpart,
   * and the one a reader that must not see tombstones asks for.
   *
   * The two are easy to confuse and the mistake is silent, so: `listChangedSince`
   * carries deletes *on purpose* (sync has to propagate them), which makes
   * `listChangedSince(0)` read like "give me every row" while actually handing
   * back rows the user deleted. Anything that is not the sync collector wants
   * this method instead. The export — the one artifact that leaves the device —
   * is what it exists for (`packages/export/README.md`).
   *
   * Lives here rather than on the three repos that first needed it so the filter
   * is structural for every synced table, present and future, and shares the
   * codec sync already maps columns with. {@link EntityRepo.list} is the
   * *narrowed* catalog read for the repos that have one (it honours `orderBy`
   * and `listOnly`, so `people.list()` leaves out unpublished people); this is
   * the unnarrowed one.
   */
  listActive(): Promise<T[]>;
  /**
   * Validate and shape a JSON payload pulled from a peer into a row of this
   * repo's type. Throws on an invalid payload (a corrupt or hostile relay).
   */
  decode(payload: unknown): T;
  /**
   * Apply a record pulled from a peer: reconcile it against the local row (if
   * any) via whole-row LWW (`resolveMerge`, plus the repo's `hasHistory` rule if
   * it declared one) and write the winner **verbatim**, preserving the incoming
   * `createdAt`/`updatedAt`/`deletedAt` (LWW only converges if the clock stays
   * the writer's).
   */
  upsertFromRemote(remote: T): Promise<void>;
}

/** The value types SQLite (node + expo) round-trips for a bound parameter. */
export type SqlValue = string | number | Uint8Array | null;

/**
 * Build an `INSERT` statement + bound params from a snake_case column map (as a
 * {@link RowCodec}'s `toRow` returns). Shared by {@link upsertFromRemote} and the
 * CRUD `insert` in `entity-repo.ts`, so both spell columns one way.
 */
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

/**
 * Build the `col = ?, …` assignment clause + bound params for an `UPDATE`,
 * skipping the `exclude` columns (e.g. `id`, or `created_at` on a CRUD update).
 * Shared by {@link upsertFromRemote} and the CRUD `update` in `entity-repo.ts`.
 */
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

/**
 * The one part of sync that is genuinely entity-specific: how a *domain* row
 * (camelCase, the shape that travels and merges) converts to and from the *table*
 * row (snake_case columns, the shape on disk).
 *
 * {@link defineSyncable} supplies a default codec that is a pure camelCase↔
 * snake_case rename — plus the two encodings SQLite's type system forces
 * (`booleans` as 0/1, `json` as TEXT) — so a plain entity needs **no codec at
 * all**. Pass an explicit one only when the two shapes genuinely differ.
 *
 * Nothing does today. `milestones` used to, sealing its `note` under a per-item
 * content key, until *encryption follows custody* (plans/encryption/model.md
 * §7.2) made that layer buy nothing for a domain field. The escape hatch stays
 * because photos will want it (plans/v0-2.md), but a shape that merely needs a
 * non-scalar column should reach for `json` rather than hand-writing a codec and
 * re-spelling every column in it.
 */
export interface RowCodec<T extends SyncRow> {
  /** Domain row → table row (snake_case columns ready to bind). */
  toRow(row: T): Record<string, SqlValue> | Promise<Record<string, SqlValue>>;
  /** Table row (snake_case, as `SELECT *` returns it) → validated domain row. */
  fromRow(raw: Record<string, unknown>): T | Promise<T>;
}

/** `firstName` → `first_name`; digits and existing underscores are untouched. */
function toSnakeCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Build the default {@link RowCodec} from a Zod object schema: column names are
 * the snake_case of the schema's field names, values pass through unchanged
 * except the two SQLite cannot hold as they are — booleans (no boolean type, so
 * 0/1) and `json` fields (no array or object type, so a TEXT round-trip).
 */
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

/**
 * Decode a `json` column. A NULL comes back as `undefined` rather than `null` so
 * the field's own Zod default applies — a column added by a migration is NULL on
 * every existing row, and "the schema decides what an absent value means" beats
 * every repo hand-coding the same `?? []`.
 *
 * Malformed text is left to Zod as the raw string: a peer that sent us garbage
 * should fail validation loudly at the row it belongs to, not be silently read
 * as an empty value here.
 */
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
  /** Present on `z.object(...)`; absent on a refined schema (then pass a `codec`). */
  shape?: Record<string, unknown>;
}

/**
 * The codec a repo will use: the explicit one if given, else the default
 * camelCase↔snake_case codec derived from the schema. Extracted so the CRUD
 * `entity-repo.ts` and {@link defineSyncable} resolve the *same* codec from the
 * same options (and `entity-repo` then hands it back in so both share one instance).
 */
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

/**
 * ============================================================================
 *  HOW TO MAKE AN ENTITY SYNC-ELIGIBLE — the canonical recipe
 * ============================================================================
 *
 * Sync is **opt-in**: an entity replicates only once its repo is registered
 * (step 4). That is deliberate — the device-local key tables (`content_key`,
 * `key_wrap`) and any future local-only table (search index, `sync_state`) must
 * *never* leave the device (plans/encryption/model.md §3), so "sync-eligible by
 * default" is exactly the wrong default. The `repos` array passed to
 * {@link createSyncEngine} is the allowlist; a guard test pins it.
 *
 * To add one more synced entity:
 *
 *   1. **Migration** — the table carries the sync substrate: a UUID `id`, and
 *      epoch-ms `created_at` / `updated_at` / nullable `deleted_at`
 *      (see AGENTS.md). Every domain table already does.
 *   2. **Schema** — a `z.object({...})` raw-row schema in `packages/schema`
 *      whose camelCase fields are the snake_case columns (`createdAt` ⇄
 *      `created_at`). This both validates a peer's payload and supplies the
 *      column list, so it is the *only* place the fields are spelled out.
 *   3. **Repo** — alongside the entity's normal CRUD, spread one call:
 *
 *        return {
 *          ...defineSyncable<Place>({ driver, table: "places", schema: placeSchema }),
 *          create, list, get, update, softDelete,  // the repo's own methods
 *        };
 *
 *      That spread supplies `table` / `decode` / `listChangedSince` /
 *      `upsertFromRemote` — no per-entity SQL. Extra options for the two cases
 *      the default can't infer:
 *        - `booleans: ["smsCapable"]` — fields SQLite stores as 0/1 (it has no
 *          boolean type). Forgetting one fails loudly on the first synced read.
 *        - `json: ["reachableOn"]` — fields SQLite stores as TEXT (it has no
 *          array or object type). See `contact-methods-repo.ts`.
 *        - `codec` — only when the on-wire shape differs from the on-disk shape
 *          (encrypted fields). No table needs one today.
 *        - `hasHistory` — only for a table whose rows two devices **mint
 *          independently under the same id**. See the option's doc-comment.
 *   4. **Register** — add the repo to the `repos` array handed to
 *      {@link createSyncEngine}, and to the allowlist guard test. This is the
 *      conscious "yes, this table may leave the device" step.
 *
 * Steps 1–2 are work any entity needs regardless of sync; steps 3–4 are the
 * whole sync cost. A round-trip is covered by the shared harness in
 * `test/sync.test.ts` — no per-entity sync test to hand-write.
 */
export function defineSyncable<T extends SyncRow>(opts: {
  driver: SqliteDriver;
  /** The transport table tag and the SQL table name (they are the same). */
  table: string;
  /** The `z.object` raw-row schema — validates payloads and names the columns. */
  schema: ParsableSchema<T>;
  /** Override the column list (default: the schema's field names). Rarely needed. */
  fields?: readonly string[];
  /** Fields stored as 0/1 because SQLite has no boolean type. */
  booleans?: readonly string[];
  /**
   * Fields stored as JSON TEXT because SQLite has no array or object type. A
   * NULL column decodes to `undefined` so the schema's own default decides what
   * an absent value means — which is what makes adding one to an existing table
   * a plain `ALTER TABLE ... ADD COLUMN` with no backfill.
   */
  json?: readonly string[];
  /** A bespoke domain↔table mapping; only for shapes that differ (encryption). */
  codec?: RowCodec<T>;
  /**
   * Narrow the merge so **an untouched row never wins**: given two versions of
   * one row, the one this predicate calls history beats the one it doesn't,
   * whatever `updated_at` says (`resolveMerge`). Omit it and the table merges by
   * plain whole-row LWW, which is the right default for almost everything.
   *
   * **Opt-in, and it should stay rare.** It can only ever fire where two devices
   * *independently mint the same id* — i.e. a deterministic-id family — because
   * anything the user creates gets a random UUID and never collides. Today the
   * only such table with a decision worth protecting is `reminders`, whose
   * engine-minted onboarding nudges were being resurrected by a peer's fresh
   * mint (`reminderHasHistory`, and `packages/reminders/README.md` → *Merge safety*).
   * The other deterministic-id families carry no per-row user decision, and the
   * holiday catalog deliberately depends on plain LWW over authored timestamps.
   *
   * This is also the seam a field-level merge grows out of, once a second
   * consumer exists — the eventual aim recorded in `packages/reminders/README.md`.
   */
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
      // `created_at` is part of the substrate every synced table carries (see
      // the recipe above), so this ordering is universal — and it is what makes
      // an export of an unchanged store reproducible byte-for-byte.
      const rows = await driver.all<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY created_at`,
      );
      return Promise.all(rows.map((row) => codec.fromRow(row)));
    },

    async upsertFromRemote(remote) {
      // Fetch the local row *including* tombstones — the merge must see a delete.
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
