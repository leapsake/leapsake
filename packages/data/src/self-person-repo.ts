import { deterministicUuid } from "@leapsake/bytes";
import {
  SELF_PERSON_ID_NAME,
  SELF_PERSON_NAMESPACE,
  type SelfPerson,
  selfPersonSchema,
  setSelfInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type EntityRepo, createEntityRepo } from "./entity-repo.js";

/** The self-person row's fixed id, the same on every device. Never change it:
 *  that would re-mint "you" and duplicate the row on sync. */
export const SELF_PERSON_ID = deterministicUuid(
  SELF_PERSON_NAMESPACE,
  SELF_PERSON_ID_NAME,
);

export interface SelfPersonRepo extends EntityRepo<SelfPerson> {
  /** The self-person row, or undefined when never picked or cleared. */
  getSelf(): Promise<SelfPerson | undefined>;
  /** Point "you" at `personId`, inserting or reviving the fixed-id row and
   *  bumping `updated_at` so the pick wins LWW. */
  setSelf(personId: string): Promise<SelfPerson>;
  /** Clear "you" with a tombstone, so the clear syncs; `setSelf` revives it. */
  clearSelf(): Promise<void>;
}

/** The self-person singleton; every write targets {@link SELF_PERSON_ID}. */
export function createSelfPersonRepo(driver: SqliteDriver): SelfPersonRepo {
  const base = createEntityRepo<SelfPerson>({
    driver,
    table: "self_person",
    schema: selfPersonSchema,
  });

  return {
    ...base,

    getSelf: () => base.get(SELF_PERSON_ID),

    async setSelf(personId) {
      const { personId: parsed } = setSelfInputSchema.parse({ personId });
      // Revive a tombstone explicitly (`update` cannot see one), with the
      // monotonic `MAX(now, updated_at + 1)` clock.
      const existing = await base.getIncludingDeleted(SELF_PERSON_ID);
      const now = Date.now();
      if (existing === undefined) {
        return base.insert({
          id: SELF_PERSON_ID,
          personId: parsed,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
      await driver.run(
        `UPDATE self_person
            SET person_id = ?, deleted_at = NULL, updated_at = MAX(?, updated_at + 1)
          WHERE id = ?`,
        [parsed, now, SELF_PERSON_ID],
      );
      // Re-read so the returned row reflects the persisted `updated_at`.
      return (await base.get(SELF_PERSON_ID)) as SelfPerson;
    },

    clearSelf: () => base.softDelete(SELF_PERSON_ID),
  };
}
