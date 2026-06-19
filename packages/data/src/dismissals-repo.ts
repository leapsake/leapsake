import {
  type EntityType,
  type RelationshipRole,
  dismissalSchema,
  resolveMerge,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import type { SyncableRepo } from "./syncable.js";

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
}

/**
 * The relationship-dismissals repository, written against the async
 * {@link SqliteDriver} port so it runs unchanged on desktop and mobile. Reads
 * exclude soft-deleted rows and writes never hard-delete (mirrors the other
 * repositories).
 */
export function createDismissalsRepo(driver: SqliteDriver): DismissalsRepo {
  /** Like {@link DismissalsRepo.listForEntity} reads but by id and incl. tombstones. */
  async function getIncludingDeleted(
    id: string,
  ): Promise<Dismissal | undefined> {
    const row = await driver.get<DismissalRow>(
      "SELECT * FROM relationship_dismissals WHERE id = ?",
      [id],
    );
    return row ? toDismissal(row) : undefined;
  }

  return {
    table: "relationship_dismissals",

    decode(payload) {
      return dismissalSchema.parse(payload);
    },

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

    async softDelete(id) {
      await driver.run(
        "UPDATE relationship_dismissals SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        [Date.now(), Date.now(), id],
      );
    },

    async removeAllForEntity(type, id) {
      const now = Date.now();
      await driver.run(
        `UPDATE relationship_dismissals
           SET deleted_at = ?, updated_at = ?
         WHERE deleted_at IS NULL
           AND ((subject_type = ? AND subject_id = ?)
             OR (other_type = ? AND other_id = ?))`,
        [now, now, type, id, type, id],
      );
    },

    async listChangedSince(since) {
      const rows = await driver.all<DismissalRow>(
        "SELECT * FROM relationship_dismissals WHERE updated_at > ? ORDER BY updated_at",
        [since],
      );
      return rows.map(toDismissal);
    },

    async upsertFromRemote(remote) {
      const local = await getIncludingDeleted(remote.id);
      if (local) {
        if (resolveMerge(local, remote) === local) return;
        await driver.run(
          `UPDATE relationship_dismissals
             SET subject_type = ?, subject_id = ?, other_type = ?, other_id = ?,
                 role = ?, created_at = ?, updated_at = ?, deleted_at = ?
           WHERE id = ?`,
          [
            remote.subjectType,
            remote.subjectId,
            remote.otherType,
            remote.otherId,
            remote.role,
            remote.createdAt,
            remote.updatedAt,
            remote.deletedAt,
            remote.id,
          ],
        );
        return;
      }
      await driver.run(
        `INSERT INTO relationship_dismissals
           (id, subject_type, subject_id, other_type, other_id, role,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          remote.id,
          remote.subjectType,
          remote.subjectId,
          remote.otherType,
          remote.otherId,
          remote.role,
          remote.createdAt,
          remote.updatedAt,
          remote.deletedAt,
        ],
      );
    },
  };
}
