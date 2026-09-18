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
  /** Remember two people are not the same; canonicalized and idempotent. */
  record(idA: string, idB: string): Promise<void>;

  /** Every remembered pair as a `"lower:higher"` key. */
  listPairs(): Promise<Set<PairKey>>;

  /** Re-point rows from `fromId` to `toId`, re-canonicalizing, and drop any
   *  that become self-pairs. Transaction-free. */
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

/** Rejected duplicate pairs, synced so no device asks again. */
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
        // Drop a row that becomes a self-pair or duplicates one the survivor
        // has.
        const collides =
          otherEnd === toId ||
          (await driver.get<{ id: string }>(
            `SELECT id FROM not_a_duplicate
              WHERE lower_id = ? AND higher_id = ? AND deleted_at IS NULL
                AND id <> ?`,
            [lower, higher, row.id],
          )) !== undefined;
        // `MAX(?, updated_at + 1)`: see the README's re-point rule.
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
