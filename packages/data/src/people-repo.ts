import {
  type CreatePersonInput,
  type Person,
  type UpdatePersonInput,
  createPersonInputSchema,
  personSchema,
  updatePersonInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** The `people` table row, exactly as stored (snake_case columns). */
interface PersonRow {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
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
      } = createPersonInputSchema.parse(input);
      const now = Date.now();
      const person: Person = {
        id: crypto.randomUUID(),
        firstName,
        middleName,
        lastName,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await driver.run(
        `INSERT INTO people
           (id, first_name, middle_name, last_name, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          person.id,
          person.firstName,
          person.middleName,
          person.lastName,
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
         SET first_name = ?, middle_name = ?, last_name = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          updated.firstName,
          updated.middleName,
          updated.lastName,
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
  };
}
