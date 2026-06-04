import {
  type CreatePetInput,
  type Pet,
  type UpdatePetInput,
  createPetInputSchema,
  petSchema,
  updatePetInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** The `pets` table row, exactly as stored (snake_case columns). */
interface PetRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Map a raw DB row to a validated `Pet`. */
function toPet(row: PetRow): Pet {
  return petSchema.parse({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export interface PetsRepo {
  create(input: CreatePetInput): Promise<Pet>;
  list(): Promise<Pet[]>;
  get(id: string): Promise<Pet | undefined>;
  update(id: string, input: UpdatePetInput): Promise<Pet | undefined>;
  softDelete(id: string): Promise<void>;
}

/**
 * The Pets repository, written against the async {@link SqliteDriver} port so
 * it runs unchanged on desktop and mobile. Excludes soft-deleted rows from all
 * reads and never hard-deletes (mirrors the People repository).
 */
export function createPetsRepo(driver: SqliteDriver): PetsRepo {
  return {
    async create(input) {
      const { name } = createPetInputSchema.parse(input);
      const now = Date.now();
      const pet: Pet = {
        id: crypto.randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await driver.run(
        `INSERT INTO pets
           (id, name, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?)`,
        [pet.id, pet.name, pet.createdAt, pet.updatedAt, pet.deletedAt],
      );
      return pet;
    },

    async list() {
      const rows = await driver.all<PetRow>(
        `SELECT * FROM pets
         WHERE deleted_at IS NULL
         ORDER BY name`,
      );
      return rows.map(toPet);
    },

    async get(id) {
      const row = await driver.get<PetRow>(
        "SELECT * FROM pets WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toPet(row) : undefined;
    },

    async update(id, input) {
      const patch = updatePetInputSchema.parse(input);
      const existing = await this.get(id);
      if (!existing) return undefined;

      const updated: Pet = {
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      };
      await driver.run(
        `UPDATE pets
         SET name = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [updated.name, updated.updatedAt, id],
      );
      return updated;
    },

    async softDelete(id) {
      await driver.run(
        "UPDATE pets SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        [Date.now(), Date.now(), id],
      );
    },
  };
}
