import {
  type CreatePersonInput,
  type Person,
  type UpdatePersonInput,
  createPersonInputSchema,
  personSchema,
  resolveMerge,
  updatePersonInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** The `people` table row, exactly as stored (snake_case columns). */
interface PersonRow {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Map a raw DB row to a validated `Person`. */
function toPerson(row: PersonRow): Person {
  return personSchema.parse({
    id: row.id,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    gender: row.gender,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export interface PeopleRepo {
  create(input: CreatePersonInput): Promise<Person>;
  list(): Promise<Person[]>;
  get(id: string): Promise<Person | undefined>;
  update(id: string, input: UpdatePersonInput): Promise<Person | undefined>;
  softDelete(id: string): Promise<void>;
  /**
   * All rows with `updated_at > since`, **including tombstones** — the sync
   * collector's source of locally-changed records (so deletes propagate).
   */
  listChangedSince(since: number): Promise<Person[]>;
  /** Like {@link get} but returns soft-deleted rows too; merge must see them. */
  getIncludingDeleted(id: string): Promise<Person | undefined>;
  /**
   * Apply a record pulled from a peer. Reconciles against the local row (if any)
   * via whole-row LWW ({@link resolveMerge}) and writes the winner **verbatim** —
   * preserving the incoming `createdAt`/`updatedAt`/`deletedAt`, never
   * re-stamping, because LWW only converges if the clock is the writer's.
   */
  upsertFromRemote(remote: Person): Promise<void>;
}

/**
 * The People repository, written against the async {@link SqliteDriver} port so
 * it runs unchanged on desktop and mobile. Excludes soft-deleted rows from all
 * reads and never hard-deletes.
 */
export function createPeopleRepo(driver: SqliteDriver): PeopleRepo {
  return {
    async create(input) {
      const {
        firstName,
        middleName = null,
        lastName,
        gender = null,
      } = createPersonInputSchema.parse(input);
      const now = Date.now();
      const person: Person = {
        id: crypto.randomUUID(),
        firstName,
        middleName,
        lastName,
        gender,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await driver.run(
        `INSERT INTO people
           (id, first_name, middle_name, last_name, gender, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          person.id,
          person.firstName,
          person.middleName,
          person.lastName,
          person.gender,
          person.createdAt,
          person.updatedAt,
          person.deletedAt,
        ],
      );
      return person;
    },

    async list() {
      const rows = await driver.all<PersonRow>(
        `SELECT * FROM people
         WHERE deleted_at IS NULL
         ORDER BY last_name, first_name`,
      );
      return rows.map(toPerson);
    },

    async get(id) {
      const row = await driver.get<PersonRow>(
        "SELECT * FROM people WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toPerson(row) : undefined;
    },

    async update(id, input) {
      const patch = updatePersonInputSchema.parse(input);
      const existing = await this.get(id);
      if (!existing) return undefined;

      const updated: Person = {
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      };
      await driver.run(
        `UPDATE people
         SET first_name = ?, middle_name = ?, last_name = ?, gender = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          updated.firstName,
          updated.middleName,
          updated.lastName,
          updated.gender,
          updated.updatedAt,
          id,
        ],
      );
      return updated;
    },

    async softDelete(id) {
      await driver.run(
        "UPDATE people SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        [Date.now(), Date.now(), id],
      );
    },

    async listChangedSince(since) {
      const rows = await driver.all<PersonRow>(
        "SELECT * FROM people WHERE updated_at > ? ORDER BY updated_at",
        [since],
      );
      return rows.map(toPerson);
    },

    async getIncludingDeleted(id) {
      const row = await driver.get<PersonRow>(
        "SELECT * FROM people WHERE id = ?",
        [id],
      );
      return row ? toPerson(row) : undefined;
    },

    async upsertFromRemote(remote) {
      const local = await this.getIncludingDeleted(remote.id);
      if (local) {
        // Local wins (or rows are identical) → nothing to write.
        if (resolveMerge(local, remote) === local) return;
        await driver.run(
          `UPDATE people
           SET first_name = ?, middle_name = ?, last_name = ?, gender = ?,
               created_at = ?, updated_at = ?, deleted_at = ?
           WHERE id = ?`,
          [
            remote.firstName,
            remote.middleName,
            remote.lastName,
            remote.gender,
            remote.createdAt,
            remote.updatedAt,
            remote.deletedAt,
            remote.id,
          ],
        );
        return;
      }
      await driver.run(
        `INSERT INTO people
           (id, first_name, middle_name, last_name, gender, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          remote.id,
          remote.firstName,
          remote.middleName,
          remote.lastName,
          remote.gender,
          remote.createdAt,
          remote.updatedAt,
          remote.deletedAt,
        ],
      );
    },
  };
}
