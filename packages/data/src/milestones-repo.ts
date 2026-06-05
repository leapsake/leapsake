import {
  type CreateMilestoneInput,
  type Milestone,
  type MilestoneSubjectType,
  type UpdateMilestoneInput,
  createMilestoneInputSchema,
  milestoneSchema,
  updateMilestoneInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** The `milestones` table row, exactly as stored (snake_case columns). */
interface MilestoneRow {
  id: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  year: number | null;
  month: number | null;
  day: number | null;
  note: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Map a raw DB row to a validated `Milestone`. */
function toMilestone(row: MilestoneRow): Milestone {
  return milestoneSchema.parse({
    id: row.id,
    kind: row.kind,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    year: row.year,
    month: row.month,
    day: row.day,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export interface MilestonesRepo {
  create(input: CreateMilestoneInput): Promise<Milestone>;
  get(id: string): Promise<Milestone | undefined>;
  update(
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone | undefined>;
  softDelete(id: string): Promise<void>;

  /**
   * Every active milestone of a subject, ordered by year, then month, then day.
   * SQLite sorts NULLs first, so a milestone missing an earlier part sorts ahead
   * of one that has it (a year-less recurring date leads a dated one).
   */
  listForSubject(type: MilestoneSubjectType, id: string): Promise<Milestone[]>;

  /**
   * Soft-delete every active milestone of a subject. Used when the host entity
   * (a Person or Pet) is deleted. Transaction-free building block — the caller
   * composes it with the entity's own delete inside one transaction.
   *
   * TODO (v2): also cascade milestones whose subject is a *relationship* the
   * entity belonged to. No such rows exist via the v1 UI yet (relationship
   * subjects aren't creatable here), so there is nothing to orphan today.
   */
  removeAllForEntity(type: MilestoneSubjectType, id: string): Promise<void>;
}

/**
 * The Milestones repository, written against the async {@link SqliteDriver} port
 * so it runs unchanged on desktop and mobile. Reads exclude soft-deleted rows
 * and writes never hard-delete.
 */
export function createMilestonesRepo(driver: SqliteDriver): MilestonesRepo {
  return {
    async create(input) {
      const parsed = createMilestoneInputSchema.parse(input);
      const now = Date.now();
      const milestone: Milestone = milestoneSchema.parse({
        id: crypto.randomUUID(),
        kind: parsed.kind,
        subjectType: parsed.subjectType,
        subjectId: parsed.subjectId,
        year: parsed.year ?? null,
        month: parsed.month ?? null,
        day: parsed.day ?? null,
        note: parsed.note ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      await driver.run(
        `INSERT INTO milestones
           (id, kind, subject_type, subject_id, year, month, day, note,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          milestone.id,
          milestone.kind,
          milestone.subjectType,
          milestone.subjectId,
          milestone.year,
          milestone.month,
          milestone.day,
          milestone.note,
          milestone.createdAt,
          milestone.updatedAt,
          milestone.deletedAt,
        ],
      );
      return milestone;
    },

    async get(id) {
      const row = await driver.get<MilestoneRow>(
        "SELECT * FROM milestones WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toMilestone(row) : undefined;
    },

    async update(id, input) {
      const patch = updateMilestoneInputSchema.parse(input);
      const existing = await this.get(id);
      if (!existing) return undefined;

      // Merge the patch, then re-validate the whole row so the day⇒month and
      // subject-type rules still hold after a partial update.
      const updated: Milestone = milestoneSchema.parse({
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      });
      await driver.run(
        `UPDATE milestones
           SET kind = ?, subject_type = ?, subject_id = ?,
               year = ?, month = ?, day = ?, note = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          updated.kind,
          updated.subjectType,
          updated.subjectId,
          updated.year,
          updated.month,
          updated.day,
          updated.note,
          updated.updatedAt,
          id,
        ],
      );
      return updated;
    },

    async softDelete(id) {
      await driver.run(
        "UPDATE milestones SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        [Date.now(), Date.now(), id],
      );
    },

    async listForSubject(type, id) {
      const rows = await driver.all<MilestoneRow>(
        `SELECT * FROM milestones
          WHERE subject_type = ? AND subject_id = ? AND deleted_at IS NULL
          ORDER BY year, month, day`,
        [type, id],
      );
      return rows.map(toMilestone);
    },

    async removeAllForEntity(type, id) {
      const now = Date.now();
      await driver.run(
        `UPDATE milestones
           SET deleted_at = ?, updated_at = ?
         WHERE subject_type = ? AND subject_id = ? AND deleted_at IS NULL`,
        [now, now, type, id],
      );
    },
  };
}
