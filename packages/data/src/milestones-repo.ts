import {
  type CreateMilestoneInput,
  type Milestone,
  type MilestoneBearerType,
  type MilestoneKind,
  type RemindEligibleMilestone,
  type UpdateMilestoneInput,
  createMilestoneInputSchema,
  milestoneSchema,
  updateMilestoneInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

export interface MilestonesRepo extends EntityRepo<Milestone> {
  create(input: CreateMilestoneInput): Promise<Milestone>;
  update(
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone | undefined>;

  /**
   * Every active milestone of a bearer, ordered by year, then month, then day.
   * SQLite sorts NULLs first, so a milestone missing an earlier part sorts ahead
   * of one that has it (a year-less recurring date leads a dated one).
   */
  listForBearer(type: MilestoneBearerType, id: string): Promise<Milestone[]>;

  /**
   * The remind-relevant, **plaintext** projection of every active milestone that
   * has a concrete calendar day (both `month` and `day` set) — the cross-bearer
   * scan the automated-reminder engine runs to decide who to remind about. It
   * reads only the plaintext columns and **never touches `note`**, so it needs
   * no {@link ContentCipher} and does no decryption; the `month IS NOT NULL AND
   * day IS NOT NULL` predicate is served by `ix_milestones_recurring (month,
   * day)` (reserved in migration 8). The engine, not the repo, applies the
   * per-kind/per-milestone "should this remind" policy.
   */
  listRemindEligible(): Promise<RemindEligibleMilestone[]>;

  /**
   * Soft-delete every active milestone of a bearer. Used when the host entity
   * (a Person or Pet) is deleted. Transaction-free building block — the caller
   * composes it with the entity's own delete inside one transaction.
   *
   * TODO (v2): also cascade milestones whose bearer is a *relationship* the
   * entity belonged to. No such rows exist via the v1 UI yet (relationship
   * bearers aren't creatable here), so there is nothing to orphan today.
   */
  removeAllForEntity(type: MilestoneBearerType, id: string): Promise<void>;

  /**
   * Re-point every active milestone of `fromId` onto `toId` (used when merging
   * `fromId` into `toId`). Per-item content keys are keyed by milestone id, not
   * bearer, so moving the bearer leaves encryption untouched. Transaction-free
   * building block.
   */
  repointEntity(
    type: MilestoneBearerType,
    fromId: string,
    toId: string,
  ): Promise<void>;
}

/**
 * The Milestones repository, written against the async {@link SqliteDriver} port
 * so it runs unchanged on desktop and mobile. Reads exclude soft-deleted rows
 * and writes never hard-delete.
 *
 * **`note` is plaintext inside the store** *(2026-07-27)*. It was briefly the one
 * domain field sealed under a per-item content key (encryption `model.md` §2.1),
 * which is why this repo used to carry a `(note, note_ciphertext)` split and a
 * custom codec. Under *encryption follows custody* (§7.2) that layer bought
 * nothing a domain field wants: an **Unauthenticated** store has no key to seal with, and a
 * **Authenticated** store is already whole-file ciphertext at rest, so per-item
 * sealing only added a second, device-local key to keep in step across sync.
 *
 * Layer 3 itself is **not** gone — `content_key`, `createContentCipher`, and
 * `EncryptedRecord.wrappedKey` remain, because photos are its real consumer
 * (`plans/v0-2.md`). It simply has no *domain-field* consumer today, which is
 * why this repo is now ordinary: no cipher, no codec, just the default
 * snake_case mapping every other entity uses.
 */
export function createMilestonesRepo(driver: SqliteDriver): MilestonesRepo {
  const base = createEntityRepo<Milestone>({
    driver,
    table: "milestones",
    schema: milestoneSchema,
    orderBy: "year, month, day",
  });

  return {
    ...base,

    async create(input) {
      const parsed = createMilestoneInputSchema.parse(input);
      const now = Date.now();
      // `insert` re-validates the day⇒month / bearer-type rules.
      return base.insert({
        id: crypto.randomUUID(),
        kind: parsed.kind,
        bearerType: parsed.bearerType,
        bearerId: parsed.bearerId,
        year: parsed.year ?? null,
        month: parsed.month ?? null,
        day: parsed.day ?? null,
        note: parsed.note ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      base.update(id, updateMilestoneInputSchema.parse(input)),

    listForBearer: (type, id) =>
      base.listWhere({
        where: "bearer_type = ? AND bearer_id = ?",
        params: [type, id],
        orderBy: "year, month, day",
      }),

    async listRemindEligible() {
      // A direct, narrow read: it selects only the columns the reminder engine
      // needs and so never surfaces `note` — worth keeping now that `note` is
      // plaintext, since the engine has no business reading it either way.
      // `kind`/`bearer_type` are our own constrained values, so they're cast to
      // their domain unions without a re-parse.
      const rows = await driver.all<{
        id: string;
        kind: string;
        bearer_type: string;
        bearer_id: string;
        year: number | null;
        month: number | null;
        day: number | null;
        created_at: number;
      }>(
        `SELECT id, kind, bearer_type, bearer_id, year, month, day, created_at
           FROM milestones
          WHERE deleted_at IS NULL AND month IS NOT NULL AND day IS NOT NULL`,
      );
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as MilestoneKind,
        bearerType: r.bearer_type as MilestoneBearerType,
        bearerId: r.bearer_id,
        year: r.year,
        month: r.month,
        day: r.day,
        createdAt: r.created_at,
      }));
    },

    removeAllForEntity: (type, id) =>
      softDeleteWhere(
        driver,
        "milestones",
        "bearer_type = ? AND bearer_id = ?",
        [type, id],
      ),

    async repointEntity(type, fromId, toId) {
      const now = Date.now();
      // `MAX(?, updated_at + 1)` keeps the re-point strictly newer than the row it
      // rewrites so it wins LWW on every device rather than tying when the merge
      // lands in the milestone's creation millisecond (see relationships-repo
      // `repointEntity`).
      await driver.run(
        `UPDATE milestones SET bearer_id = ?, updated_at = MAX(?, updated_at + 1)
           WHERE bearer_type = ? AND bearer_id = ? AND deleted_at IS NULL`,
        [toId, now, type, fromId],
      );
    },
  };
}
