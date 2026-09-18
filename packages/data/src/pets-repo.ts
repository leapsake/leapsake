import {
  PUBLISHED_SQL,
  type CreatePetInput,
  type Pet,
  type UpdatePetInput,
  createPetInputSchema,
  petSchema,
  updatePetInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type EntityRepo, createEntityRepo } from "./entity-repo.js";

export interface PetsRepo extends EntityRepo<Pet> {
  create(input: CreatePetInput): Promise<Pet>;
  update(id: string, input: UpdatePetInput): Promise<Pet | undefined>;
}

/** The pets repository. */
export function createPetsRepo(driver: SqliteDriver): PetsRepo {
  const base = createEntityRepo<Pet>({
    driver,
    table: "pets",
    schema: petSchema,
    orderBy: "name",
    // The catalog holds the user's own pets; see the People repo's note.
    listOnly: PUBLISHED_SQL,
  });

  return {
    ...base,

    async create(input) {
      const {
        name,
        gender = null,
        standing = "published",
      } = createPetInputSchema.parse(input);
      const now = Date.now();
      return base.insert({
        id: crypto.randomUUID(),
        name,
        gender,
        standing,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      base.update(id, updatePetInputSchema.parse(input)),
  };
}
