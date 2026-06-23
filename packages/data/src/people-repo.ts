import {
  type CreatePersonInput,
  type Person,
  type UpdatePersonInput,
  createPersonInputSchema,
  personSchema,
  updatePersonInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type EntityRepo, createEntityRepo } from "./entity-repo.js";

export interface PeopleRepo extends EntityRepo<Person> {
  create(input: CreatePersonInput): Promise<Person>;
  update(id: string, input: UpdatePersonInput): Promise<Person | undefined>;
}

/**
 * The People repository, written against the async {@link SqliteDriver} port so
 * it runs unchanged on desktop and mobile. The standard CRUD (get/list/update/
 * softDelete/getIncludingDeleted) and the sync surface come from
 * {@link createEntityRepo}; only `create` (input parse + assemble) is bespoke.
 */
export function createPeopleRepo(driver: SqliteDriver): PeopleRepo {
  const base = createEntityRepo<Person>({
    driver,
    table: "people",
    schema: personSchema,
    orderBy: "last_name, first_name",
  });

  return {
    ...base,

    async create(input) {
      const {
        firstName,
        middleName = null,
        lastName,
        gender = null,
      } = createPersonInputSchema.parse(input);
      const now = Date.now();
      return base.insert({
        id: crypto.randomUUID(),
        firstName,
        middleName,
        lastName,
        gender,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      base.update(id, updatePersonInputSchema.parse(input)),
  };
}
