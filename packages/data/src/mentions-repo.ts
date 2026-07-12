import { deterministicUuid } from "@leapsake/crypto";
import {
  type EntityType,
  MENTION_NAMESPACE,
  type MentionBearerType,
  type Mentioning,
  mentioningSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { softDeleteRow, softDeleteWhere } from "./entity-repo.js";
import { type SyncableRepo, defineSyncable } from "./syncable.js";

/** The `mentions` table row, exactly as stored (snake_case columns). */
interface MentionRow {
  id: string;
  bearer_type: string;
  bearer_id: string;
  target_type: string;
  target_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Map a raw DB row to a validated {@link Mentioning}. */
function toMentioning(row: MentionRow): Mentioning {
  return mentioningSchema.parse({
    id: row.id,
    bearerType: row.bearer_type,
    bearerId: row.bearer_id,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

/** A mention target — the referenced entity, without the display-name snapshot. */
export interface MentionTarget {
  targetType: EntityType;
  targetId: string;
}

/**
 * The **deterministic** id a mention row is content-addressed under. Derived from
 * the full `(bearer, target)` tuple, so a mention re-derived from the same text on
 * another device reuses the same row and whole-row LWW dedups it — the same trick
 * that keeps a system reminder's own id stable across devices.
 */
function mentionRowId(
  bearerType: string,
  bearerId: string,
  targetType: string,
  targetId: string,
): string {
  return deterministicUuid(
    MENTION_NAMESPACE,
    `${bearerType}:${bearerId}:${targetType}:${targetId}`,
  );
}

export interface MentionsRepo extends SyncableRepo<Mentioning> {
  /**
   * Make the bearer's mentions exactly `targets`: insert a row for each newly
   * mentioned entity, soft-delete rows for targets no longer mentioned. Ids are
   * deterministic, so a re-derived mention reuses its row — a tombstoned one is
   * **un-deleted** (the text is authoritative; there is no dismissal to respect),
   * an already-active one is left untouched (idempotent). Unlike a tag, a mention
   * target is a real, independently-owned entity, so **nothing is garbage-collected
   * on removal**. Transaction-free building block: the caller wraps it.
   */
  setEntityMentions(
    bearerType: MentionBearerType,
    bearerId: string,
    targets: MentionTarget[],
  ): Promise<void>;

  /** Active mentions embedded in one bearer's text (drives read-time resolution). */
  listForBearer(
    bearerType: MentionBearerType,
    bearerId: string,
  ): Promise<Mentioning[]>;

  /**
   * Active bearer ids whose text mentions this entity — the indexed **backlink**
   * (`ix_mentions_target`) that powers "what references this person/pet?". Pass
   * `bearerType` to scope to one kind of bearer (e.g. only reminders).
   */
  bearerIdsForTarget(
    targetType: EntityType,
    targetId: string,
    bearerType?: MentionBearerType,
  ): Promise<string[]>;

  /**
   * Soft-delete all of a bearer's mentions — used when the host bearer (e.g. a
   * reminder) is deleted. Transaction-free building block.
   */
  removeAllForBearer(
    bearerType: MentionBearerType,
    bearerId: string,
  ): Promise<void>;
}

/**
 * The Mentions repository over the async {@link SqliteDriver} port. The `mentions`
 * table is its own synced unit (a plaintext backlink of `(bearer, target)` id
 * pairs — non-secret within the account, like `taggings`), so the sync surface
 * comes from {@link defineSyncable}; the bearer-oriented write/read API below is
 * the reconcile core drives on every reminder write.
 *
 * Write methods are transaction-free building blocks, matching {@link
 * ./tags-repo.js createTagsRepo}: a single user action composes a reminder write
 * with a mention write, and the caller wraps the whole thing in one
 * `driver.transaction` — the node:sqlite driver's BEGIN/COMMIT does not nest.
 */
export function createMentionsRepo(driver: SqliteDriver): MentionsRepo {
  return {
    ...defineSyncable<Mentioning>({
      driver,
      table: "mentions",
      schema: mentioningSchema,
    }),

    async setEntityMentions(bearerType, bearerId, targets) {
      // Desired set, keyed by target identity (defensively deduped).
      const desired = new Map<string, MentionTarget>();
      for (const t of targets) desired.set(`${t.targetType}:${t.targetId}`, t);

      // Current active rows for this bearer — soft-delete any target that left.
      const current = await driver.all<MentionRow>(
        `SELECT * FROM mentions
          WHERE bearer_type = ? AND bearer_id = ? AND deleted_at IS NULL`,
        [bearerType, bearerId],
      );
      for (const row of current) {
        if (!desired.has(`${row.target_type}:${row.target_id}`)) {
          await softDeleteRow(driver, "mentions", row.id);
        }
      }

      // Ensure an active row for each desired target (insert / un-delete / leave).
      const now = Date.now();
      for (const t of desired.values()) {
        const id = mentionRowId(bearerType, bearerId, t.targetType, t.targetId);
        const existing = await driver.get<{ deleted_at: number | null }>(
          "SELECT deleted_at FROM mentions WHERE id = ?",
          [id],
        );
        if (existing === undefined) {
          await driver.run(
            `INSERT INTO mentions
               (id, bearer_type, bearer_id, target_type, target_id,
                created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              bearerType,
              bearerId,
              t.targetType,
              t.targetId,
              now,
              now,
              null,
            ],
          );
        } else if (existing.deleted_at !== null) {
          // Re-mentioned after removal — resurrect the deterministic row and bump
          // its clock so the un-delete wins LWW on every device.
          await driver.run(
            "UPDATE mentions SET deleted_at = NULL, updated_at = MAX(?, updated_at + 1) WHERE id = ?",
            [now, id],
          );
        }
      }
    },

    async listForBearer(bearerType, bearerId) {
      const rows = await driver.all<MentionRow>(
        `SELECT * FROM mentions
          WHERE bearer_type = ? AND bearer_id = ? AND deleted_at IS NULL
          ORDER BY created_at`,
        [bearerType, bearerId],
      );
      return rows.map(toMentioning);
    },

    async bearerIdsForTarget(targetType, targetId, bearerType) {
      const rows = await driver.all<{ bearer_id: string }>(
        `SELECT bearer_id FROM mentions
          WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL${
            bearerType ? " AND bearer_type = ?" : ""
          }`,
        bearerType
          ? [targetType, targetId, bearerType]
          : [targetType, targetId],
      );
      return rows.map((r) => r.bearer_id);
    },

    async removeAllForBearer(bearerType, bearerId) {
      await softDeleteWhere(
        driver,
        "mentions",
        "bearer_type = ? AND bearer_id = ?",
        [bearerType, bearerId],
      );
    },
  };
}
