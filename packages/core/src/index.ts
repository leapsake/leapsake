import {
  type GenderResult,
  type SqliteDriver,
  createContactMethodsRepo,
  createDismissalsRepo,
  createKinshipService,
  createMilestonesRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  createSearchService,
  createTagsRepo,
  listContactMethods,
  listTimelineForEntity,
  runMigrations,
} from "@leapsake/data";
import type {
  ContactMethod,
  ContactOwnerType,
  CreateEmailInput,
  CreateMilestoneInput,
  CreatePersonInput,
  CreatePetInput,
  CreatePhoneInput,
  CreatePostalInput,
  CreateRelationshipInput,
  EmailAddress,
  EntityType,
  Milestone,
  MilestoneSubjectType,
  MilestoneTimelineEntry,
  Person,
  Pet,
  PhoneNumber,
  PostalAddress,
  Relationship,
  RelationshipNeighbor,
  RelationshipRole,
  SearchHit,
  Tag,
  UpdateEmailInput,
  UpdateMilestoneInput,
  UpdatePersonInput,
  UpdatePetInput,
  UpdatePhoneInput,
  UpdatePostalInput,
  UpdateRelationshipInput,
} from "@leapsake/schema";
import { entityLabel, roleDefs } from "@leapsake/schema";

// Re-exported so apps can wire everything from one entry point: construct a
// concrete SqliteDriver, run migrations, then build the core.
export { runMigrations, type SqliteDriver, type GenderResult };

/**
 * The client-agnostic application surface. Every operation is a composition over
 * the repositories in `@leapsake/data` — transactional writes, cascade deletes,
 * relationship orientation, label resolution, and the cross-repo read services.
 * It is deliberately free of any transport (Electron IPC) or UI concern, so each
 * client uses it the same way:
 *
 * - **Desktop** builds the core in the Electron main process and forwards each
 *   method over typed IPC (`window.api`).
 * - **Mobile (Expo/RN)** builds the core in-process and calls it directly.
 *
 * The shape mirrors what the desktop renderer already consumes as `window.api`,
 * so the desktop preload can derive its type from {@link CoreApi}.
 */
export type CoreApi = ReturnType<typeof createCore>;

/**
 * Wire the repositories and services over a {@link SqliteDriver} and return the
 * composed {@link CoreApi}. Synchronous wiring only — run {@link runMigrations}
 * against the same driver before issuing any query.
 *
 * Inputs are passed straight to the repositories, which validate them with their
 * Zod schemas internally. A client that accepts untrusted input (e.g. the desktop
 * IPC boundary) should additionally parse at its trust boundary before calling in.
 */
export function createCore(driver: SqliteDriver) {
  const people = createPeopleRepo(driver);
  const pets = createPetsRepo(driver);
  const tags = createTagsRepo(driver);
  const relationships = createRelationshipsRepo(driver);
  const dismissals = createDismissalsRepo(driver);
  const milestones = createMilestonesRepo(driver);
  const contactMethods = createContactMethodsRepo(driver);
  const kinship = createKinshipService(driver, {
    people,
    pets,
    relationships,
    dismissals,
  });
  const search = createSearchService(driver);

  // Resolve an entity to its display label for relationship rows and timeline
  // annotations, using the shared `@leapsake/schema` formatters so every client
  // labels entities identically. Returns undefined when the entity is gone so
  // callers can skip a missing neighbor.
  async function resolveLabel(
    type: EntityType,
    id: string,
  ): Promise<string | undefined> {
    if (type === "person") {
      const person = await people.get(id);
      return person ? entityLabel("person", person) : undefined;
    }
    const pet = await pets.get(id);
    return pet ? entityLabel("pet", pet) : undefined;
  }

  return {
    people: {
      list: (): Promise<Person[]> => people.list(),
      get: (id: string): Promise<Person | undefined> => people.get(id),
      // A Person's write and its tag changes commit in one transaction, so a
      // partial failure rolls back both.
      create: (input: CreatePersonInput, tagNames: string[]): Promise<Person> =>
        driver.transaction(async () => {
          const person = await people.create(input);
          await tags.setEntityTags("person", person.id, tagNames);
          return person;
        }),
      update: (
        id: string,
        input: UpdatePersonInput,
        tagNames: string[],
      ): Promise<Person | undefined> =>
        driver.transaction(async () => {
          const person = await people.update(id, input);
          if (person) {
            await tags.setEntityTags("person", id, tagNames);
          }
          return person;
        }),
      // Soft-delete the person and cascade across every fact that references it.
      softDelete: (id: string): Promise<void> =>
        driver.transaction(async () => {
          await people.softDelete(id);
          await tags.removeAllForEntity("person", id);
          await relationships.removeAllForEntity("person", id);
          await dismissals.removeAllForEntity("person", id);
          await milestones.removeAllForEntity("person", id);
          await contactMethods.removeAllForOwner("person", id);
        }),
    },

    pets: {
      list: (): Promise<Pet[]> => pets.list(),
      get: (id: string): Promise<Pet | undefined> => pets.get(id),
      create: (input: CreatePetInput, tagNames: string[]): Promise<Pet> =>
        driver.transaction(async () => {
          const pet = await pets.create(input);
          await tags.setEntityTags("pet", pet.id, tagNames);
          return pet;
        }),
      update: (
        id: string,
        input: UpdatePetInput,
        tagNames: string[],
      ): Promise<Pet | undefined> =>
        driver.transaction(async () => {
          const pet = await pets.update(id, input);
          if (pet) {
            await tags.setEntityTags("pet", id, tagNames);
          }
          return pet;
        }),
      softDelete: (id: string): Promise<void> =>
        driver.transaction(async () => {
          await pets.softDelete(id);
          await tags.removeAllForEntity("pet", id);
          await relationships.removeAllForEntity("pet", id);
          await dismissals.removeAllForEntity("pet", id);
          await milestones.removeAllForEntity("pet", id);
        }),
    },

    tags: {
      get: (id: string): Promise<Tag | undefined> => tags.get(id),
      softDelete: (id: string): Promise<void> =>
        driver.transaction(() => tags.softDelete(id)),
      listForPerson: (personId: string): Promise<Tag[]> =>
        tags.listForEntity("person", personId),
      listForPet: (petId: string): Promise<Tag[]> =>
        tags.listForEntity("pet", petId),
      peopleForTag: async (tagId: string): Promise<Person[]> => {
        const ids = await tags.entityIdsForTag(tagId, "person");
        const found = await Promise.all(ids.map((id) => people.get(id)));
        return found.filter((p): p is Person => p !== undefined);
      },
      petsForTag: async (tagId: string): Promise<Pet[]> => {
        const ids = await tags.entityIdsForTag(tagId, "pet");
        const found = await Promise.all(ids.map((id) => pets.get(id)));
        return found.filter((p): p is Pet => p !== undefined);
      },
    },

    relationships: {
      get: (id: string): Promise<Relationship | undefined> =>
        relationships.get(id),
      create: (input: CreateRelationshipInput): Promise<Relationship> =>
        driver.transaction(() => relationships.create(input)),
      update: (
        id: string,
        input: UpdateRelationshipInput,
      ): Promise<Relationship | undefined> =>
        driver.transaction(() => relationships.update(id, input)),
      softDelete: (id: string): Promise<void> =>
        driver.transaction(() => relationships.softDelete(id)),
      // Orient each stored row to the subject and resolve the *other* end's
      // label + role, so the caller never sees the raw a/b endpoints.
      listForEntity: async (
        type: EntityType,
        id: string,
      ): Promise<RelationshipNeighbor[]> => {
        const rows = await relationships.listForEntity(type, id);
        const neighbors: RelationshipNeighbor[] = [];
        for (const rel of rows) {
          const subjectIsA = rel.aType === type && rel.aId === id;
          const otherType = subjectIsA ? rel.bType : rel.aType;
          const otherId = subjectIsA ? rel.bId : rel.aId;
          const otherRole = subjectIsA ? rel.bRole : rel.aRole;
          const otherRoleNote = subjectIsA ? rel.bRoleNote : rel.aRoleNote;
          const otherLabel = await resolveLabel(otherType, otherId);
          if (otherLabel === undefined) continue; // other end gone — skip
          neighbors.push({
            relationshipId: rel.id,
            otherType,
            otherId,
            otherLabel,
            otherRole,
            otherRoleLabel: roleDefs[otherRole].label,
            otherRoleNote,
            origin: "explicit",
          });
        }
        return neighbors;
      },
    },

    milestones: {
      listForSubject: (
        type: MilestoneSubjectType,
        id: string,
      ): Promise<Milestone[]> => milestones.listForSubject(type, id),
      // Own milestones merged with those of each explicit relationship the entity
      // is in, resolved read-only and annotated with the partner's label.
      timelineFor: (
        type: EntityType,
        id: string,
      ): Promise<MilestoneTimelineEntry[]> =>
        listTimelineForEntity(
          milestones,
          relationships,
          resolveLabel,
          type,
          id,
        ),
      create: (input: CreateMilestoneInput): Promise<Milestone> =>
        driver.transaction(() => milestones.create(input)),
      update: (
        id: string,
        input: UpdateMilestoneInput,
      ): Promise<Milestone | undefined> =>
        driver.transaction(() => milestones.update(id, input)),
      softDelete: (id: string): Promise<void> =>
        driver.transaction(() => milestones.softDelete(id)),
    },

    contactMethods: {
      // Merged read fans out across the three typed tables; writes target one
      // typed sub-repo each.
      listForOwner: (
        type: ContactOwnerType,
        id: string,
      ): Promise<ContactMethod[]> =>
        listContactMethods(contactMethods, { type, id }),
      emails: {
        create: (input: CreateEmailInput): Promise<EmailAddress> =>
          driver.transaction(() => contactMethods.emails.create(input)),
        update: (
          id: string,
          input: UpdateEmailInput,
        ): Promise<EmailAddress | undefined> =>
          driver.transaction(() => contactMethods.emails.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => contactMethods.emails.softDelete(id)),
      },
      phones: {
        create: (input: CreatePhoneInput): Promise<PhoneNumber> =>
          driver.transaction(() => contactMethods.phones.create(input)),
        update: (
          id: string,
          input: UpdatePhoneInput,
        ): Promise<PhoneNumber | undefined> =>
          driver.transaction(() => contactMethods.phones.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => contactMethods.phones.softDelete(id)),
      },
      postals: {
        create: (input: CreatePostalInput): Promise<PostalAddress> =>
          driver.transaction(() => contactMethods.postals.create(input)),
        update: (
          id: string,
          input: UpdatePostalInput,
        ): Promise<PostalAddress | undefined> =>
          driver.transaction(() => contactMethods.postals.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => contactMethods.postals.softDelete(id)),
      },
    },

    kinship: {
      neighborsFor: (
        type: EntityType,
        id: string,
      ): Promise<RelationshipNeighbor[]> => kinship.neighborsFor(type, id),
      genderFor: (type: EntityType, id: string): Promise<GenderResult> =>
        kinship.genderFor(type, id),
      dismiss: (
        subjectType: EntityType,
        subjectId: string,
        otherType: EntityType,
        otherId: string,
        role: RelationshipRole | null,
      ): Promise<void> =>
        driver.transaction(async () => {
          await dismissals.create(
            { type: subjectType, id: subjectId },
            { type: otherType, id: otherId },
            role,
          );
        }),
      undismiss: (id: string): Promise<void> =>
        driver.transaction(() => dismissals.softDelete(id)),
    },

    search: {
      query: (term: string): Promise<SearchHit[]> => search.query(term),
    },
  };
}
