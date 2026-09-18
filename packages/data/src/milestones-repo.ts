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

  /** A bearer's active milestones by year, month, day; NULLs sort first. */
  listForBearer(type: MilestoneBearerType, id: string): Promise<Milestone[]>;

  /** Every active milestone with a month and day, across bearers, for the
   *  reminder engine. Never reads `note`. */
  listRemindEligible(): Promise<RemindEligibleMilestone[]>;

  /** Soft-delete a bearer's milestones. Transaction-free. TODO: also cascade
   *  milestones borne by a relationship the entity was in. */
  removeAllForEntity(type: MilestoneBearerType, id: string): Promise<void>;

  /** Re-point a bearer's milestones onto `toId`. Transaction-free. */
  repointEntity(
    type: MilestoneBearerType,
    fromId: string,
    toId: string,
  ): Promise<void>;
}

/** The milestones repository. */
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
      // Only the columns the engine needs, never `note`; `kind` and
      // `bearer_type` are cast without a re-parse.
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
      // `MAX(?, updated_at + 1)`: see the README's re-point rule.
      await driver.run(
        `UPDATE milestones SET bearer_id = ?, updated_at = MAX(?, updated_at + 1)
           WHERE bearer_type = ? AND bearer_id = ? AND deleted_at IS NULL`,
        [toId, now, type, fromId],
      );
    },
  };
}
