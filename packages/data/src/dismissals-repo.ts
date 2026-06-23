import {
  type EntityType,
  type RelationshipRole,
  dismissalSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { softDeleteRow, softDeleteWhere } from "./entity-repo.js";
import { type SyncableRepo, defineSyncable } from "./syncable.js";

/** An endpoint of a dismissal: an entity `(type, id)` pair. */
export interface DismissalEndpoint {
  type: EntityType;
  id: string;
}

/**
 * A rejected *derived* relationship. The inference engine recomputes derived
 * edges on every read; a dismissal is the persistent "no, not that one" so a
 * rejected edge stays gone. `role` is the dismissed base role, or `null` to
 * suppress any derived edge between the pair.
 */
export interface Dismissal {
  id: string;
  subjectType: EntityType;
  subjectId: string;
  otherType: EntityType;
  otherId: string;
  role: RelationshipRole | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** The `relationship_dismissals` table row, exactly as stored (snake_case). */
interface DismissalRow {
  id: string;
  subject_type: string;
  subject_id: string;
  other_type: string;
  other_id: string;
  role: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Map a raw DB row to a `Dismissal`. */
function toDismissal(row: DismissalRow): Dismissal {
  return {
    id: row.id,
    subjectType: row.subject_type as EntityType,
    subjectId: row.subject_id,
    otherType: row.other_type as EntityType,
    otherId: row.other_id,
    role: row.role as RelationshipRole | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export interface DismissalsRepo extends SyncableRepo<Dismissal> {
  /** Record a dismissal of a derived edge from `subject` to `other` (optionally role-scoped). */
  create(
    subject: DismissalEndpoint,
    other: DismissalEndpoint,
    role: RelationshipRole | null,
  ): Promise<Dismissal>;

  /** Active dismissals whose *subject* is this entity — what the engine filters against. */
  listForEntity(type: EntityType, id: string): Promise<Dismissal[]>;

  /** Restore a dismissed edge (soft-delete the dismissal row). */
  softDelete(id: string): Promise<void>;

  /**
   * Soft-delete every active dismissal touching an entity on *either* end. Used
   * when the host entity is deleted. Transaction-free building block — the caller
   * composes it inside one `driver.transaction`.
   */
  removeAllForEntity(type: EntityType, id: string): Promise<void>;

  /**
   * Re-point every active dismissal touching `fromId` on *either* end onto
   * `toId` (used when merging `fromId` into `toId`), then drop any dismissal that
   * now points the survivor at itself. Transaction-free building block.
   */
  repointEntity(type: EntityType, fromId: string, toId: string): Promise<void>;
}

/**
 * The relationship-dismissals repository, written against the async
 * {@link SqliteDriver} port so it runs unchanged on desktop and mobile. Reads
 * exclude soft-deleted rows and writes never hard-delete (mirrors the other
 * repositories).
 */
export function createDismissalsRepo(driver: SqliteDriver): DismissalsRepo {
  return {
    ...defineSyncable<Dismissal>({
      driver,
      table: "relationship_dismissals",
      schema: dismissalSchema,
    }),

    async create(subject, other, role) {
      const now = Date.now();
      const dismissal: Dismissal = {
        id: crypto.randomUUID(),
        subjectType: subject.type,
        subjectId: subject.id,
        otherType: other.type,
        otherId: other.id,
        role,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await driver.run(
        `INSERT INTO relationship_dismissals
           (id, subject_type, subject_id, other_type, other_id, role,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dismissal.id,
          dismissal.subjectType,
          dismissal.subjectId,
          dismissal.otherType,
          dismissal.otherId,
          dismissal.role,
          dismissal.createdAt,
          dismissal.updatedAt,
          dismissal.deletedAt,
        ],
      );
      return dismissal;
    },

    async listForEntity(type, id) {
      const rows = await driver.all<DismissalRow>(
        `SELECT * FROM relationship_dismissals
          WHERE deleted_at IS NULL
            AND subject_type = ? AND subject_id = ?
          ORDER BY created_at`,
        [type, id],
      );
      return rows.map(toDismissal);
    },

    softDelete: (id) => softDeleteRow(driver, "relationship_dismissals", id),

    removeAllForEntity: (type, id) =>
      softDeleteWhere(
        driver,
        "relationship_dismissals",
        "(subject_type = ? AND subject_id = ?) OR (other_type = ? AND other_id = ?)",
        [type, id, type, id],
      ),

    async repointEntity(type, fromId, toId) {
      const now = Date.now();
      // `MAX(?, updated_at + 1)` makes each re-point strictly newer than the row
      // it rewrites so it wins LWW on every device rather than tying when the
      // merge lands in the dismissal's creation millisecond (see relationships-repo
      // `repointEntity`).
      await driver.run(
        `UPDATE relationship_dismissals SET subject_id = ?, updated_at = MAX(?, updated_at + 1)
           WHERE subject_type = ? AND subject_id = ? AND deleted_at IS NULL`,
        [toId, now, type, fromId],
      );
      await driver.run(
        `UPDATE relationship_dismissals SET other_id = ?, updated_at = MAX(?, updated_at + 1)
           WHERE other_type = ? AND other_id = ? AND deleted_at IS NULL`,
        [toId, now, type, fromId],
      );
      // A dismissal whose two ends are now the survivor suppresses an edge from a
      // person to themselves — meaningless, so drop it.
      await softDeleteWhere(
        driver,
        "relationship_dismissals",
        "subject_type = ? AND subject_id = ? AND other_type = ? AND other_id = ?",
        [type, toId, type, toId],
      );
    },
  };
}
