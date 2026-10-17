import {
  PUBLISHED_SQL,
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
  /** A fresh `id` unless given one, as a draft its screens link to is. */
  create(input: CreatePersonInput, id?: string): Promise<Person>;
  update(id: string, input: UpdatePersonInput): Promise<Person | undefined>;
}

/** The people repository. */
export function createPeopleRepo(driver: SqliteDriver): PeopleRepo {
  const base = createEntityRepo<Person>({
    driver,
    table: "people",
    schema: personSchema,
    json: ["nationalities", "religions"],
    // Sort each person by whichever name part they have.
    orderBy: "COALESCE(last_name, first_name, middle_name), first_name",
    // The catalog: every list and picker builds from here, so unpublished
    // people stay out of them all.
    listOnly: PUBLISHED_SQL,
  });

  return {
    ...base,

    async create(input, id = crypto.randomUUID()) {
      const {
        firstName = null,
        middleName = null,
        lastName = null,
        gender = null,
        nationalities = [],
        religions = [],
        // Spelled out rather than left to the schema's default, because the row
        // this assembles is typed as a complete Person.
        standing = "published",
      } = createPersonInputSchema.parse(input);
      const now = Date.now();
      return base.insert({
        id,
        firstName,
        middleName,
        lastName,
        gender,
        nationalities,
        religions,
        standing,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      base.update(id, updatePersonInputSchema.parse(input)),
  };
}
