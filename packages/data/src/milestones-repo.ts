import {
  type CreateMilestoneInput,
  type Milestone,
  type MilestoneSubjectType,
  type UpdateMilestoneInput,
  createMilestoneInputSchema,
  milestoneSchema,
  updateMilestoneInputSchema,
} from "@leapsake/schema";
import type { ContentCipher } from "./content-cipher.js";
import type { SqliteDriver } from "./driver.js";

/** The entity type under which a milestone's content key is registered. */
const MILESTONE_ENTITY = "milestone";

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
  note_ciphertext: Uint8Array | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/**
 * Map a raw DB row to a validated `Milestone`, decrypting `note` when it is
 * stored as ciphertext. A row written by a key-bearing client carries
 * `note_ciphertext` and a null plaintext `note`; a legacy (pre-encryption) row
 * carries the reverse, so we fall back to the plaintext column unchanged.
 */
async function toMilestone(
  row: MilestoneRow,
  cipher: ContentCipher | undefined,
): Promise<Milestone> {
  let note = row.note;
  if (row.note_ciphertext !== null) {
    if (cipher === undefined) {
      throw new Error(
        `milestone ${row.id} has an encrypted note but no key is wired`,
      );
    }
    // node:sqlite hands BLOBs back as a Buffer; normalize to a plain Uint8Array
    // for the crypto primitives (mirrors key-wrap-repo).
    note = await cipher.openField(
      MILESTONE_ENTITY,
      row.id,
      Uint8Array.from(row.note_ciphertext),
    );
  }
  return milestoneSchema.parse({
    id: row.id,
    kind: row.kind,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    year: row.year,
    month: row.month,
    day: row.day,
    note,
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
 *
 * When a {@link ContentCipher} is supplied (a client with an unlocked key), the
 * free-text `note` is encrypted at rest under the milestone's per-item content
 * key: writes store the sealed bytes in `note_ciphertext` and null the plaintext
 * `note` column; reads decrypt transparently, so the `Milestone` shape callers
 * see is unchanged. Without a cipher the repo stores and returns plaintext, as
 * before — keeping every existing (keyless) caller working.
 */
export function createMilestonesRepo(
  driver: SqliteDriver,
  cipher?: ContentCipher,
): MilestonesRepo {
  /**
   * Split a note into the `(note, note_ciphertext)` column pair to persist:
   * ciphertext (plaintext nulled) when a cipher is wired and the note is set,
   * otherwise plaintext (ciphertext nulled). Writing both columns every time
   * means clearing a note clears both, and an updated legacy row upgrades to
   * ciphertext.
   */
  async function noteColumns(
    id: string,
    note: string | null,
  ): Promise<[string | null, Uint8Array | null]> {
    if (cipher !== undefined && note !== null) {
      return [null, await cipher.sealField(MILESTONE_ENTITY, id, note)];
    }
    return [note, null];
  }

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
      const [note, noteCiphertext] = await noteColumns(
        milestone.id,
        milestone.note,
      );
      await driver.run(
        `INSERT INTO milestones
           (id, kind, subject_type, subject_id, year, month, day, note,
            note_ciphertext, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          milestone.id,
          milestone.kind,
          milestone.subjectType,
          milestone.subjectId,
          milestone.year,
          milestone.month,
          milestone.day,
          note,
          noteCiphertext,
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
      return row ? toMilestone(row, cipher) : undefined;
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
      const [note, noteCiphertext] = await noteColumns(id, updated.note);
      await driver.run(
        `UPDATE milestones
           SET kind = ?, subject_type = ?, subject_id = ?,
               year = ?, month = ?, day = ?, note = ?, note_ciphertext = ?,
               updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          updated.kind,
          updated.subjectType,
          updated.subjectId,
          updated.year,
          updated.month,
          updated.day,
          note,
          noteCiphertext,
          updated.updatedAt,
          id,
        ],
      );
      return updated;
    },

    async softDelete(id) {
      // Note: a soft-deleted milestone leaves its content_key + key_wrap rows in
      // place. Orphaned content keys are harmless (the ciphertext they protect is
      // also gone); key revocation/GC is a later (sync-era) concern.
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
      return Promise.all(rows.map((row) => toMilestone(row, cipher)));
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
