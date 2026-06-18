import {
  type CreateRelationshipInput,
  type EntityType,
  type Relationship,
  type UpdateRelationshipInput,
  createRelationshipInputSchema,
  relationshipSchema,
  updateRelationshipInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type SyncableRepo, defineSyncable } from "./syncable.js";

/** The `relationships` table row, exactly as stored (snake_case columns). */
interface RelationshipRow {
  id: string;
  a_type: string;
  a_id: string;
  a_role: string;
  a_role_note: string | null;
  b_type: string;
  b_id: string;
  b_role: string;
  b_role_note: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Map a raw DB row to a validated `Relationship`. */
function toRelationship(row: RelationshipRow): Relationship {
  return relationshipSchema.parse({
    id: row.id,
    aType: row.a_type,
    aId: row.a_id,
    aRole: row.a_role,
    aRoleNote: row.a_role_note,
    bType: row.b_type,
    bId: row.b_id,
    bRole: row.b_role,
    bRoleNote: row.b_role_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export interface RelationshipsRepo extends SyncableRepo<Relationship> {
  create(input: CreateRelationshipInput): Promise<Relationship>;
  get(id: string): Promise<Relationship | undefined>;
  update(
    id: string,
    input: UpdateRelationshipInput,
  ): Promise<Relationship | undefined>;
  softDelete(id: string): Promise<void>;

  /**
   * Every active relationship touching an entity, whichever side it sits on. The
   * one place the "either endpoint" OR-query lives; callers orient each row to
   * the subject themselves.
   */
  listForEntity(type: EntityType, id: string): Promise<Relationship[]>;

  /**
   * Soft-delete every active relationship touching an entity. Used when the host
   * entity (a Person or Pet) is deleted. Transaction-free building block — the
   * caller composes it with the entity's own delete inside one transaction.
   */
  removeAllForEntity(type: EntityType, id: string): Promise<void>;
}

/**
 * The Relationships repository, written against the async {@link SqliteDriver}
 * port so it runs unchanged on desktop and mobile. Reads exclude soft-deleted
 * rows and writes never hard-delete.
 */
export function createRelationshipsRepo(
  driver: SqliteDriver,
): RelationshipsRepo {
  return {
    ...defineSyncable<Relationship>({
      driver,
      table: "relationships",
      schema: relationshipSchema,
    }),

    async create(input) {
      const parsed = createRelationshipInputSchema.parse(input);
      const now = Date.now();
      const relationship: Relationship = relationshipSchema.parse({
        id: crypto.randomUUID(),
        aType: parsed.aType,
        aId: parsed.aId,
        aRole: parsed.aRole,
        aRoleNote: parsed.aRoleNote ?? null,
        bType: parsed.bType,
        bId: parsed.bId,
        bRole: parsed.bRole,
        bRoleNote: parsed.bRoleNote ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      await driver.run(
        `INSERT INTO relationships
           (id, a_type, a_id, a_role, a_role_note,
            b_type, b_id, b_role, b_role_note,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          relationship.id,
          relationship.aType,
          relationship.aId,
          relationship.aRole,
          relationship.aRoleNote,
          relationship.bType,
          relationship.bId,
          relationship.bRole,
          relationship.bRoleNote,
          relationship.createdAt,
          relationship.updatedAt,
          relationship.deletedAt,
        ],
      );
      return relationship;
    },

    async get(id) {
      const row = await driver.get<RelationshipRow>(
        "SELECT * FROM relationships WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toRelationship(row) : undefined;
    },

    async update(id, input) {
      const patch = updateRelationshipInputSchema.parse(input);
      const existing = await this.get(id);
      if (!existing) return undefined;

      // Merge the patch, then re-validate the whole row so the note/holder rules
      // still hold after a partial update of the roles.
      const updated: Relationship = relationshipSchema.parse({
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      });
      await driver.run(
        `UPDATE relationships
           SET a_role = ?, a_role_note = ?, b_role = ?, b_role_note = ?,
               updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          updated.aRole,
          updated.aRoleNote,
          updated.bRole,
          updated.bRoleNote,
          updated.updatedAt,
          id,
        ],
      );
      return updated;
    },

    async softDelete(id) {
      await driver.run(
        "UPDATE relationships SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        [Date.now(), Date.now(), id],
      );
    },

    async listForEntity(type, id) {
      const rows = await driver.all<RelationshipRow>(
        `SELECT * FROM relationships
          WHERE deleted_at IS NULL
            AND ((a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?))
          ORDER BY created_at`,
        [type, id, type, id],
      );
      return rows.map(toRelationship);
    },

    async removeAllForEntity(type, id) {
      const now = Date.now();
      await driver.run(
        `UPDATE relationships
           SET deleted_at = ?, updated_at = ?
         WHERE deleted_at IS NULL
           AND ((a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?))`,
        [now, now, type, id, type, id],
      );
    },
  };
}
