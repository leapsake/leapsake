import {
  type Tag,
  type Tagging,
  normalizeTagName,
  parseTagNames,
  tagSchema,
  taggingSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { softDeleteRow, softDeleteWhere } from "./entity-repo.js";
import { type SyncableRepo, defineSyncable } from "./syncable.js";

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

/** A tag with how many things wear it, across every bearer type. */
export interface TagListItem extends Tag {
  usageCount: number;
}

export interface TagsRepo extends SyncableRepo<Tag> {
  /** The `taggings` join table, synced alongside the tags. */
  taggings: SyncableRepo<Tagging>;

  /** Tags currently applied to an entity, via its active taggings. */
  listForEntity(entityType: string, entityId: string): Promise<Tag[]>;

  /** Make an entity's tags exactly `names` (normalized, deduped), then
   *  soft-delete any tag left with no taggings. */
  setEntityTags(
    entityType: string,
    entityId: string,
    names: string[],
  ): Promise<void>;

  /** Soft-delete an entity's taggings, then GC orphaned tags. */
  removeAllForEntity(entityType: string, entityId: string): Promise<void>;

  /** Move taggings from `fromId` to `toId`, dropping the loser's where the
   *  survivor has the tag. Transaction-free. */
  repointEntity(
    entityType: string,
    fromId: string,
    toId: string,
  ): Promise<void>;

  /** Soft-delete a tag and every tagging that applies it. Transaction-free. */
  softDelete(tagId: string): Promise<void>;

  /** Every active tag, alphabetically, with its tagging count. */
  list(): Promise<TagListItem[]>;

  get(id: string): Promise<Tag | undefined>;

  /** Active ids of `entityType` bearing this tag, for the tag page. */
  entityIdsForTag(tagId: string, entityType: string): Promise<string[]>;
}

/** The tags repository. Writes are transaction-free, since the node:sqlite
 *  driver's transactions do not nest. */
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
      await softDeleteRow(driver, "tags", tagId);
    }
  }

  /** The `taggings` join table as a standalone {@link SyncableRepo}. */
  const taggings: SyncableRepo<Tagging> = defineSyncable<Tagging>({
    driver,
    table: "taggings",
    schema: taggingSchema,
  });

  return {
    ...defineSyncable<Tag>({ driver, table: "tags", schema: tagSchema }),
    taggings,

    async listForEntity(entityType, entityId) {
      const rows = await driver.all<TagRow>(
        `SELECT t.* FROM tags t
           JOIN taggings g ON g.tag_id = t.id
          WHERE g.bearer_type = ? AND g.bearer_id = ?
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
          WHERE g.bearer_type = ? AND g.bearer_id = ?
            AND g.deleted_at IS NULL AND t.deleted_at IS NULL`,
        [entityType, entityId],
      );
      const currentByKey = new Map(current.map((r) => [r.normalized, r]));

      // Remove taggings whose tag is no longer desired, then GC the tag.
      for (const row of current) {
        if (desiredKeys.has(row.normalized)) continue;
        await softDeleteRow(driver, "taggings", row.tagging_id);
        await gcTagIfOrphaned(row.id);
      }

      // Add taggings for newly desired names.
      for (const name of desired) {
        if (currentByKey.has(normalizeTagName(name))) continue;
        const tag = await resolveOrCreateTag(name);
        const now = Date.now();
        await driver.run(
          `INSERT INTO taggings
             (id, tag_id, bearer_type, bearer_id, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), tag.id, entityType, entityId, now, now, null],
        );
      }
    },

    async removeAllForEntity(entityType, entityId) {
      const rows = await driver.all<{ id: string; tag_id: string }>(
        `SELECT id, tag_id FROM taggings
          WHERE bearer_type = ? AND bearer_id = ? AND deleted_at IS NULL`,
        [entityType, entityId],
      );
      for (const { id, tag_id } of rows) {
        await softDeleteRow(driver, "taggings", id);
        await gcTagIfOrphaned(tag_id);
      }
    },

    async repointEntity(entityType, fromId, toId) {
      const now = Date.now();
      const survivorTagIds = new Set(
        (
          await driver.all<{ tag_id: string }>(
            `SELECT tag_id FROM taggings
              WHERE bearer_type = ? AND bearer_id = ? AND deleted_at IS NULL`,
            [entityType, toId],
          )
        ).map((r) => r.tag_id),
      );
      const fromTaggings = await driver.all<{ id: string; tag_id: string }>(
        `SELECT id, tag_id FROM taggings
          WHERE bearer_type = ? AND bearer_id = ? AND deleted_at IS NULL`,
        [entityType, fromId],
      );
      // `MAX(?, updated_at + 1)`: see the README's re-point rule.
      for (const { id, tag_id } of fromTaggings) {
        if (survivorTagIds.has(tag_id)) {
          // Survivor already wears this tag — drop the would-be duplicate.
          await softDeleteRow(driver, "taggings", id);
        } else {
          await driver.run(
            "UPDATE taggings SET bearer_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?",
            [toId, now, id],
          );
          survivorTagIds.add(tag_id);
        }
      }
    },

    async softDelete(tagId) {
      await softDeleteWhere(driver, "taggings", "tag_id = ?", [tagId]);
      await softDeleteRow(driver, "tags", tagId);
    },

    async list() {
      // Sorted case-insensitively. LEFT JOIN, so a taggingless tag pulled from
      // a peer is still listed and deletable.
      const rows = await driver.all<TagRow & { usage_count: number }>(
        `SELECT t.*, COUNT(g.id) AS usage_count
           FROM tags t
           LEFT JOIN taggings g ON g.tag_id = t.id AND g.deleted_at IS NULL
          WHERE t.deleted_at IS NULL
          GROUP BY t.id
          ORDER BY t.normalized`,
      );
      return rows.map((row) => ({
        ...toTag(row),
        usageCount: row.usage_count,
      }));
    },

    async get(id) {
      const row = await driver.get<TagRow>(
        "SELECT * FROM tags WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toTag(row) : undefined;
    },

    async entityIdsForTag(tagId, entityType) {
      const rows = await driver.all<{ bearer_id: string }>(
        `SELECT bearer_id FROM taggings
          WHERE tag_id = ? AND bearer_type = ? AND deleted_at IS NULL`,
        [tagId, entityType],
      );
      return rows.map((r) => r.bearer_id);
    },
  };
}
