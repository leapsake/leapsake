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
import { deterministicUuid } from "@leapsake/bytes";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

export interface MilestonesRepo extends EntityRepo<Milestone> {
  /** `imported` marks a milestone a contacts import wrote. */
  create(
    input: CreateMilestoneInput,
    opts?: { imported?: boolean },
  ): Promise<Milestone>;
  update(
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone | undefined>;

  /** A bearer's active milestones by year, month, day; NULLs sort first. */
  listForBearer(type: MilestoneBearerType, id: string): Promise<Milestone[]>;

  /** Every active milestone with a month and day, across bearers, for the
   *  reminder engine. Never reads `note`. */
  listRemindEligible(): Promise<RemindEligibleMilestone[]>;

  /** Soft-delete a bearer's milestones. Transaction-free. */
  removeAllForEntity(type: MilestoneBearerType, id: string): Promise<void>;

  /** Move one milestone onto another bearer, of any type. Transaction-free. */
  moveToBearer(
    id: string,
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<void>;

  /** Copy a milestone onto another bearer, under an id derived from both so
   *  every device mints the same copy; `created` is false if it already was. */
  copyToBearer(
    milestone: Milestone,
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<{ id: string; created: boolean }>;

  /** Re-point a bearer's milestones onto `toId`. Transaction-free. */
  repointEntity(
    type: MilestoneBearerType,
    fromId: string,
    toId: string,
  ): Promise<void>;
}

const MILESTONE_COPY_NAMESPACE = "leapsake:milestone-copy";

/** The milestones repository. */
export function createMilestonesRepo(driver: SqliteDriver): MilestonesRepo {
  const base = createEntityRepo<Milestone>({
    driver,
    table: "milestones",
    schema: milestoneSchema,
    orderBy: "year, month, day",
    booleans: ["imported"],
  });

  return {
    ...base,

    async create(input, opts) {
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
        imported: opts?.imported ?? false,
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
        imported: number;
      }>(
        `SELECT id, kind, bearer_type, bearer_id, year, month, day, created_at,
                imported
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
        imported: r.imported === 1,
      }));
    },

    removeAllForEntity: (type, id) =>
      softDeleteWhere(
        driver,
        "milestones",
        "bearer_type = ? AND bearer_id = ?",
        [type, id],
      ),

    async moveToBearer(id, bearerType, bearerId) {
      const now = Date.now();
      // `MAX(?, updated_at + 1)`: see the README's re-point rule.
      await driver.run(
        `UPDATE milestones
            SET bearer_type = ?, bearer_id = ?, updated_at = MAX(?, updated_at + 1)
          WHERE id = ? AND deleted_at IS NULL`,
        [bearerType, bearerId, now, id],
      );
    },

    async copyToBearer(milestone, bearerType, bearerId) {
      const id = deterministicUuid(
        MILESTONE_COPY_NAMESPACE,
        `${milestone.id}:${bearerType}:${bearerId}`,
      );
      if ((await base.getIncludingDeleted(id)) !== undefined)
        return { id, created: false };
      const now = Date.now();
      await base.insert({
        ...milestone,
        id,
        bearerType,
        bearerId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      return { id, created: true };
    },

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
