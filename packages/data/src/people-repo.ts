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
    // Every name part is optional now, so a plain "last_name, first_name" would
    // file everyone without a surname — the mononyms, and the people known only
    // as somebody's spouse — in a block at the top under NULL. Sort each person
    // by whichever part they actually have.
    orderBy: "COALESCE(last_name, first_name, middle_name), first_name",
    // `list()` is the user's catalog, so it holds only the user's own people —
    // an unpublished person belongs to whoever they're a fact about, and is read
    // from there by id. This one line is what keeps them out of People & Pets,
    // out of every relationship and observer picker, and out of duplicate
    // detection, all of which build their lists from here.
    listOnly: PUBLISHED_SQL,
  });

  return {
    ...base,

    async create(input) {
      const {
        firstName = null,
        middleName = null,
        lastName = null,
        gender = null,
        // Spelled out rather than left to the schema's default, because the row
        // this assembles is typed as a complete Person.
        standing = "published",
      } = createPersonInputSchema.parse(input);
      const now = Date.now();
      return base.insert({
        id: crypto.randomUUID(),
        firstName,
        middleName,
        lastName,
        gender,
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
