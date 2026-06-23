import { type NotADuplicate, notADuplicateSchema } from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { softDeleteRow } from "./entity-repo.js";
import { type SyncableRepo, defineSyncable } from "./syncable.js";

export type { NotADuplicate };

/** The `"lower:higher"` key the detector filters candidate pairs against. */
export type PairKey = string;

/** Order two ids so an unordered pair maps to one canonical row. */
function canonicalPair(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA];
}

export interface NotADuplicateRepo extends SyncableRepo<NotADuplicate> {
  /**
   * Remember that the two people are **not** the same. Canonicalizes the pair
   * (order-independent), and is idempotent: if an active row for the pair already
   * exists it bumps `updatedAt` rather than inserting a duplicate.
   */
  record(idA: string, idB: string): Promise<void>;

  /**
   * Every remembered pair as a `Set` of `"lower:higher"` keys — what the
   * duplicate detector filters its candidates against.
   */
  listPairs(): Promise<Set<PairKey>>;

  /**
   * Re-point every active row touching `fromId` onto `toId` (used when merging
   * `fromId` into `toId`), re-canonalizing each pair, then drop any row that
   * becomes a self-pair (`lower_id === higher_id`). Transaction-free building
   * block — the caller composes it inside `core.people.merge`'s transaction.
   */
  repointEntity(fromId: string, toId: string): Promise<void>;
}

interface NotADuplicateRow {
  id: string;
  lower_id: string;
  higher_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/**
 * The "not a duplicate" memory repository — rejected reconciliation pairs. Built
 * against the async {@link SqliteDriver} port so it runs unchanged on desktop and
 * mobile. It is a {@link SyncableRepo} (the rejection must replicate, else every
 * device re-nags about a pair the user already dismissed) — see
 * packages/core/README.md.
 */
export function createNotADuplicateRepo(
  driver: SqliteDriver,
): NotADuplicateRepo {
  return {
    ...defineSyncable<NotADuplicate>({
      driver,
      table: "not_a_duplicate",
      schema: notADuplicateSchema,
    }),

    async record(idA, idB) {
      const [lower, higher] = canonicalPair(idA, idB);
      const now = Date.now();
      const existing = await driver.get<{ id: string }>(
        `SELECT id FROM not_a_duplicate
          WHERE lower_id = ? AND higher_id = ? AND deleted_at IS NULL`,
        [lower, higher],
      );
      if (existing !== undefined) {
        await driver.run(
          "UPDATE not_a_duplicate SET updated_at = ? WHERE id = ?",
          [now, existing.id],
        );
        return;
      }
      await driver.run(
        `INSERT INTO not_a_duplicate
           (id, lower_id, higher_id, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), lower, higher, now, now, null],
      );
    },

    async listPairs() {
      const rows = await driver.all<NotADuplicateRow>(
        "SELECT lower_id, higher_id FROM not_a_duplicate WHERE deleted_at IS NULL",
      );
      return new Set(rows.map((row) => `${row.lower_id}:${row.higher_id}`));
    },

    async repointEntity(fromId, toId) {
      const now = Date.now();
      // Re-point both ends onto the survivor, re-canonicalizing each pair so the
      // (lower, higher) invariant holds afterwards. Active rows only.
      const rows = await driver.all<NotADuplicateRow>(
        `SELECT * FROM not_a_duplicate
          WHERE deleted_at IS NULL AND (lower_id = ? OR higher_id = ?)`,
        [fromId, fromId],
      );
      for (const row of rows) {
        const otherEnd = row.lower_id === fromId ? row.higher_id : row.lower_id;
        const [lower, higher] = canonicalPair(toId, otherEnd);
        // Drop the row if re-pointing makes it a self-pair (survivor↔itself) or a
        // duplicate of a pair the survivor already remembers (the partial unique
        // index would otherwise reject the update) — both are now redundant.
        const collides =
          otherEnd === toId ||
          (await driver.get<{ id: string }>(
            `SELECT id FROM not_a_duplicate
              WHERE lower_id = ? AND higher_id = ? AND deleted_at IS NULL
                AND id <> ?`,
            [lower, higher, row.id],
          )) !== undefined;
        // `MAX(?, updated_at + 1)` keeps each re-point strictly newer than the row
        // it rewrites so it wins LWW on every device rather than tying when the
        // merge lands in the row's creation millisecond (see relationships-repo
        // `repointEntity`).
        if (collides) {
          await softDeleteRow(driver, "not_a_duplicate", row.id);
          continue;
        }
        await driver.run(
          `UPDATE not_a_duplicate SET lower_id = ?, higher_id = ?, updated_at = MAX(?, updated_at + 1)
             WHERE id = ?`,
          [lower, higher, now, row.id],
        );
      }
    },
  };
}
