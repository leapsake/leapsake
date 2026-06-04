import type { SqliteDriver } from "./driver.js";

/** A single ordered, forward-only schema change. */
export interface Migration {
  version: number;
  up(driver: SqliteDriver): Promise<void>;
}

/**
 * The ordered migration list. Append new migrations with the next integer
 * version; never edit or reorder existing ones. Portable SQL only, so the same
 * migrations run on better-sqlite3 (desktop) and expo-sqlite (mobile).
 */
export const migrations: Migration[] = [
  {
    version: 1,
    async up(driver) {
      await driver.exec(`
        CREATE TABLE people (
          id         TEXT    PRIMARY KEY,
          first_name TEXT    NOT NULL,
          last_name  TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
      `);
    },
  },
  {
    version: 2,
    async up(driver) {
      await driver.exec(`ALTER TABLE people ADD COLUMN middle_name TEXT;`);
    },
  },
  {
    version: 3,
    async up(driver) {
      // Tags and a polymorphic join. `taggings.entity_type`/`entity_id` point at
      // any entity (just 'person' today), so new entity types tag in without a
      // schema change. Partial unique indexes scoped to `deleted_at IS NULL`
      // enforce "one active row per key" while letting soft-deleted history
      // coexist (reboot-plan.md §4.2 soft-delete + sync).
      await driver.exec(`
        CREATE TABLE tags (
          id         TEXT    PRIMARY KEY,
          name       TEXT    NOT NULL,
          normalized TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
        CREATE UNIQUE INDEX ux_tags_active_normalized
          ON tags(normalized) WHERE deleted_at IS NULL;

        CREATE TABLE taggings (
          id          TEXT    PRIMARY KEY,
          tag_id      TEXT    NOT NULL,
          entity_type TEXT    NOT NULL,
          entity_id   TEXT    NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        CREATE UNIQUE INDEX ux_taggings_active
          ON taggings(tag_id, entity_type, entity_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_taggings_entity
          ON taggings(entity_type, entity_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_taggings_tag
          ON taggings(tag_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 4,
    async up(driver) {
      // A relationship is one directed edge stored as a single row holding both
      // endpoints and both roles (schema/relationship.ts). Endpoints are
      // polymorphic `(type, id)` pairs like taggings, so Pets join later without
      // touching this table. Two partial indexes (one per side) cover the
      // "relationships touching entity X" reads. There is deliberately NO unique
      // index on the pair: the same two entities may relate in more than one way.
      await driver.exec(`
        CREATE TABLE relationships (
          id          TEXT    PRIMARY KEY,
          a_type      TEXT    NOT NULL,
          a_id        TEXT    NOT NULL,
          a_role      TEXT    NOT NULL,
          a_role_note TEXT,
          b_type      TEXT    NOT NULL,
          b_id        TEXT    NOT NULL,
          b_role      TEXT    NOT NULL,
          b_role_note TEXT,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        CREATE INDEX ix_relationships_a
          ON relationships(a_type, a_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_relationships_b
          ON relationships(b_type, b_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 5,
    async up(driver) {
      // Pet entity. A minimal row (just a name today) that plugs into the
      // existing polymorphic taggings and relationships tables — no schema
      // change needed there. Same sync-safe conventions as people.
      await driver.exec(`
        CREATE TABLE pets (
          id         TEXT    PRIMARY KEY,
          name       TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
      `);
    },
  },
];

/**
 * Apply any migrations newer than the database's current `user_version`, each
 * inside a transaction, then bump `user_version`. Cheap hand-rolled runner in
 * place of a migration library (reboot-plan.md §4.5).
 */
export async function runMigrations(
  driver: SqliteDriver,
  steps: Migration[] = migrations,
): Promise<void> {
  const row = await driver.get<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;

  const pending = steps
    .filter((step) => step.version > current)
    .toSorted((a, b) => a.version - b.version);

  for (const step of pending) {
    await driver.transaction(async () => {
      await step.up(driver);
      // PRAGMA user_version does not accept bound parameters; the version is a
      // trusted integer from our own migration list, so interpolation is safe.
      await driver.exec(`PRAGMA user_version = ${step.version}`);
    });
  }
}
