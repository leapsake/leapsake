import {
  type ContentKey,
  type CreateContentKeyInput,
  contentKeySchema,
  createContentKeyInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** The `content_key` table row, exactly as stored (snake_case columns). */
interface ContentKeyRow {
  id: string;
  entity_type: string;
  entity_id: string;
  blob_ref: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Map a raw DB row to a validated `ContentKey`. */
function toContentKey(row: ContentKeyRow): ContentKey {
  return contentKeySchema.parse({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    blobRef: row.blob_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export interface ContentKeyRepo {
  create(input: CreateContentKeyInput): Promise<ContentKey>;
  get(id: string): Promise<ContentKey | undefined>;
  getForEntity(
    entityType: string,
    entityId: string,
  ): Promise<ContentKey | undefined>;
}

/**
 * The content-key registry repository. Registers
 * that an entity has a content key — never the key bytes, which live only as
 * `key_wrap` ciphertext. Written against the async {@link SqliteDriver} port so
 * it runs unchanged on desktop and mobile; excludes soft-deleted rows from
 * reads and never hard-deletes (mirrors the domain repositories).
 */
export function createContentKeyRepo(driver: SqliteDriver): ContentKeyRepo {
  return {
    async create(input) {
      const {
        entityType,
        entityId,
        blobRef = null,
      } = createContentKeyInputSchema.parse(input);
      const now = Date.now();
      const contentKey: ContentKey = {
        id: crypto.randomUUID(),
        entityType,
        entityId,
        blobRef,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await driver.run(
        `INSERT INTO content_key
           (id, entity_type, entity_id, blob_ref, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          contentKey.id,
          contentKey.entityType,
          contentKey.entityId,
          contentKey.blobRef,
          contentKey.createdAt,
          contentKey.updatedAt,
          contentKey.deletedAt,
        ],
      );
      return contentKey;
    },

    async get(id) {
      const row = await driver.get<ContentKeyRow>(
        "SELECT * FROM content_key WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toContentKey(row) : undefined;
    },

    async getForEntity(entityType, entityId) {
      const row = await driver.get<ContentKeyRow>(
        `SELECT * FROM content_key
         WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL`,
        [entityType, entityId],
      );
      return row ? toContentKey(row) : undefined;
    },
  };
}
