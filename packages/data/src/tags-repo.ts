import {
  type Tag,
  normalizeTagName,
  parseTagNames,
  tagSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** The `tags` table row, exactly as stored (snake_case columns). */
interface TagRow {
  id: string;
  name: string;
  normalized: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Map a raw DB row to a validated `Tag`. */
function toTag(row: TagRow): Tag {
  return tagSchema.parse({
    id: row.id,
    name: row.name,
    normalized: row.normalized,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export interface TagsRepo {
  /** Tags currently applied to an entity, via its active taggings. */
  listForEntity(entityType: string, entityId: string): Promise<Tag[]>;

  /**
   * Make the entity's tags exactly `names`: tag any new names (reusing or
   * creating shared tags), soft-delete taggings for dropped names, then
   * soft-delete any tag left with no active taggings. Names are normalized and
   * deduped first.
   */
  setEntityTags(
    entityType: string,
    entityId: string,
    names: string[],
  ): Promise<void>;

  /**
   * Soft-delete all of an entity's taggings, then garbage-collect any tag left
   * orphaned. Used when the host entity (e.g. a Person) is deleted.
   */
  removeAllForEntity(entityType: string, entityId: string): Promise<void>;

  get(id: string): Promise<Tag | undefined>;

  /** Active entity ids of `entityType` bearing this tag — powers the tag page. */
  entityIdsForTag(tagId: string, entityType: string): Promise<string[]>;
}

/**
 * The Tags repository, written against the async {@link SqliteDriver} port so it
 * runs unchanged on desktop and mobile. Reads exclude soft-deleted rows and
 * writes never hard-delete.
 *
 * Write methods are transaction-free building blocks: a single user action
 * (saving a Person) composes a person write with tag writes, and the caller
 * wraps the whole thing in one `driver.transaction` — the node:sqlite driver's
 * BEGIN/COMMIT does not nest, so these methods must not open their own.
 */
export function createTagsRepo(driver: SqliteDriver): TagsRepo {
  /** Find the active tag for a normalized name, or create one. */
  async function resolveOrCreateTag(name: string): Promise<TagRow> {
    const normalized = normalizeTagName(name);
    const existing = await driver.get<TagRow>(
      "SELECT * FROM tags WHERE normalized = ? AND deleted_at IS NULL",
      [normalized],
    );
    if (existing) return existing;

    const now = Date.now();
    const row: TagRow = {
      id: crypto.randomUUID(),
      name,
      normalized,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await driver.run(
      `INSERT INTO tags
         (id, name, normalized, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.name, row.normalized, row.created_at, row.updated_at, null],
    );
    return row;
  }

  /** Soft-delete a tag once it has no active taggings left. */
  async function gcTagIfOrphaned(tagId: string): Promise<void> {
    const remaining = await driver.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM taggings WHERE tag_id = ? AND deleted_at IS NULL",
      [tagId],
    );
    if ((remaining?.n ?? 0) === 0) {
      await driver.run(
        "UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        [Date.now(), Date.now(), tagId],
      );
    }
  }

  return {
    async listForEntity(entityType, entityId) {
      const rows = await driver.all<TagRow>(
        `SELECT t.* FROM tags t
           JOIN taggings g ON g.tag_id = t.id
          WHERE g.entity_type = ? AND g.entity_id = ?
            AND g.deleted_at IS NULL AND t.deleted_at IS NULL
          ORDER BY t.name`,
        [entityType, entityId],
      );
      return rows.map(toTag);
    },

    async setEntityTags(entityType, entityId, names) {
      // Normalize + dedupe the desired set, keyed by normalized form.
      const desired = parseTagNames(names.join(","));
      const desiredKeys = new Set(desired.map(normalizeTagName));

      // Current active taggings for this entity, keyed by tag normalized form.
      const current = await driver.all<TagRow & { tagging_id: string }>(
        `SELECT t.*, g.id AS tagging_id FROM taggings g
           JOIN tags t ON t.id = g.tag_id
          WHERE g.entity_type = ? AND g.entity_id = ?
            AND g.deleted_at IS NULL AND t.deleted_at IS NULL`,
        [entityType, entityId],
      );
      const currentByKey = new Map(current.map((r) => [r.normalized, r]));

      // Remove taggings whose tag is no longer desired, then GC the tag.
      for (const row of current) {
        if (desiredKeys.has(row.normalized)) continue;
        await driver.run(
          "UPDATE taggings SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
          [Date.now(), Date.now(), row.tagging_id],
        );
        await gcTagIfOrphaned(row.id);
      }

      // Add taggings for newly desired names.
      for (const name of desired) {
        if (currentByKey.has(normalizeTagName(name))) continue;
        const tag = await resolveOrCreateTag(name);
        const now = Date.now();
        await driver.run(
          `INSERT INTO taggings
             (id, tag_id, entity_type, entity_id, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), tag.id, entityType, entityId, now, now, null],
        );
      }
    },

    async removeAllForEntity(entityType, entityId) {
      const taggings = await driver.all<{ id: string; tag_id: string }>(
        `SELECT id, tag_id FROM taggings
          WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL`,
        [entityType, entityId],
      );
      for (const { id, tag_id } of taggings) {
        await driver.run(
          "UPDATE taggings SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
          [Date.now(), Date.now(), id],
        );
        await gcTagIfOrphaned(tag_id);
      }
    },

    async get(id) {
      const row = await driver.get<TagRow>(
        "SELECT * FROM tags WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toTag(row) : undefined;
    },

    async entityIdsForTag(tagId, entityType) {
      const rows = await driver.all<{ entity_id: string }>(
        `SELECT entity_id FROM taggings
          WHERE tag_id = ? AND entity_type = ? AND deleted_at IS NULL`,
        [tagId, entityType],
      );
      return rows.map((r) => r.entity_id);
    },
  };
}
