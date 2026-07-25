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

/**
 * The one, constant primary key of the `self_person` row — identical on every
 * device. Content-addressed like the holiday ids (see `holidays-repo.ts`), but
 * with a *fixed* name because there is exactly one self-person: both devices
 * write the same PK, so a divergent pick converges by whole-row LWW instead of
 * colliding. Kept constant forever — moving it would
 * re-mint "you" and duplicate the row on next sync.
 */
export const SELF_PERSON_ID = deterministicUuid(
  SELF_PERSON_NAMESPACE,
  SELF_PERSON_ID_NAME,
);

export interface SelfPersonRepo extends EntityRepo<SelfPerson> {
  /** The self-person row, or undefined when unset (never picked, or cleared). */
  getSelf(): Promise<SelfPerson | undefined>;
  /**
   * Point "you" at `personId` — the singleton upsert. Inserts the fixed-PK row
   * the first time, or re-points an existing one (re-activating it if it had been
   * cleared), always bumping `updated_at` so the pick wins LWW on sync. A
   * concurrent pick on another device merges to this one row.
   */
  setSelf(personId: string): Promise<SelfPerson>;
  /**
   * Clear "you" — soft-delete the singleton so {@link getSelf} reads undefined.
   * Reversible: a later {@link setSelf} re-activates the same PK. (A tombstone,
   * not a hard delete, so the clear itself propagates on sync.)
   */
  clearSelf(): Promise<void>;
}

/**
 * The self-person repository — a fixed-PK singleton over the async
 * {@link SqliteDriver} port. Plaintext (no {@link ContentCipher}), like reminders:
 * a self pointer is not a share target and rides whole-DB-at-rest + the master-
 * key sync seal. Standard CRUD + the sync surface come from {@link createEntityRepo};
 * only the three singleton accessors are bespoke — every write targets the one
 * constant {@link SELF_PERSON_ID}.
 */
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
      // The row may exist as a tombstone (a previously-cleared self), which
      // `update` would not see — so revive/re-point it with the same raw idiom
      // the observances repo uses: clear `deleted_at` and advance `updated_at`
      // monotonically (`MAX(now, updated_at + 1)`) so the pick out-ranks any
      // stale copy on every device and wins LWW.
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
