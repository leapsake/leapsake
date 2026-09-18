import {
  type EntityType,
  type Person,
  type Pet,
  entityLabel,
  isPublished,
} from "@leapsake/schema";
import type { ContactMethodsRepo } from "./contact-methods-repo.js";
import type { DismissalsRepo } from "./dismissals-repo.js";
import type { SqliteDriver } from "./driver.js";
import type { GiftRecipientsRepo } from "./gift-recipients-repo.js";
import type { ObservancesRepo } from "./holidays-repo.js";
import type { MilestonesRepo } from "./milestones-repo.js";
import type { NotADuplicateRepo } from "./not-a-duplicate-repo.js";
import type { PeopleRepo } from "./people-repo.js";
import type { PetsRepo } from "./pets-repo.js";
import type { RelationshipsRepo } from "./relationships-repo.js";
import type { TagsRepo } from "./tags-repo.js";

/** Whether a patch makes an entity more than a name. A name edit does not; a
 *  patch that sets `standing` itself is left alone. */
export function promotes(
  input: Record<string, unknown>,
  nameFields: readonly string[],
  tagNames: readonly string[],
): boolean {
  if ("standing" in input) return false;
  return (
    tagNames.length > 0 ||
    Object.keys(input).some((field) => !nameFields.includes(field))
  );
}

export interface EntityServiceDeps {
  people: PeopleRepo;
  pets: PetsRepo;
  tags: TagsRepo;
  relationships: RelationshipsRepo;
  dismissals: DismissalsRepo;
  milestones: MilestonesRepo;
  contactMethods: ContactMethodsRepo;
  observances: ObservancesRepo;
  giftRecipients: GiftRecipientsRepo;
  notADuplicate: NotADuplicateRepo;
  /** Composes a whole merge into one transaction. */
  driver: SqliteDriver;
}

export interface EntityService {
  /** The row behind an endpoint, unpublished included. */
  resolve(type: EntityType, id: string): Promise<Person | Pet | undefined>;
  /** An entity's display label, from the shared formatter; `undefined` when
   *  it is gone. */
  label(type: EntityType, id: string): Promise<string | undefined>;
  softDelete(type: EntityType, id: string): Promise<void>;
  removeFacts(type: EntityType, id: string): Promise<void>;
  attachedUnpublished(
    type: EntityType,
    id: string,
  ): Promise<{ type: EntityType; id: string }[]>;
  softDeleteCascade(type: EntityType, id: string): Promise<void>;
  publishIfUnpublished(type: EntityType, id: string): Promise<void>;
  publishBearerIfUnpublished(type: string, id: string): Promise<void>;
  mergePeople(survivorId: string, loserId: string): Promise<void>;
}

/** Cross-repo writes on a whole person or pet: cascade delete, promotion out
 *  of unpublished, and merging two people. */
export function createEntityService(deps: EntityServiceDeps): EntityService {
  const {
    people,
    pets,
    tags,
    relationships,
    dismissals,
    milestones,
    contactMethods,
    observances,
    giftRecipients,
    notADuplicate,
    driver,
  } = deps;

  const resolve = (
    type: EntityType,
    id: string,
  ): Promise<Person | Pet | undefined> =>
    type === "person" ? people.get(id) : pets.get(id);

  const label = async (
    type: EntityType,
    id: string,
  ): Promise<string | undefined> => {
    const entity = await resolve(type, id);
    return entity ? entityLabel(type, entity) : undefined;
  };

  const softDelete = (type: EntityType, id: string): Promise<void> =>
    type === "person" ? people.softDelete(id) : pets.softDelete(id);

  /** Soft-delete every fact on an entity; the one list both cascades share.
   *  Transaction-free: callers are already inside one. */
  async function removeFacts(type: EntityType, id: string): Promise<void> {
    await tags.removeAllForEntity(type, id);
    await relationships.removeAllForEntity(type, id);
    await dismissals.removeAllForEntity(type, id);
    await milestones.removeAllForEntity(type, id);
    if (type === "person") {
      await contactMethods.removeAllForOwner("person", id);
    }
    await observances.removeAllForBearer(type, id);
    await giftRecipients.removeAllForRecipient(type, id);
  }

  /** The unpublished ends of this entity's explicit relationships. Read before
   *  the relationships are removed: the edge is what ties them here. */
  async function attachedUnpublished(
    type: EntityType,
    id: string,
  ): Promise<{ type: EntityType; id: string }[]> {
    const rows = await relationships.listForEntity(type, id);
    const attached: { type: EntityType; id: string }[] = [];
    for (const rel of rows) {
      const subjectIsA = rel.aType === type && rel.aId === id;
      const end = {
        type: subjectIsA ? rel.bType : rel.aType,
        id: subjectIsA ? rel.bId : rel.aId,
      };
      const other = await resolve(end.type, end.id);
      if (other !== undefined && !isPublished(other.standing)) {
        attached.push(end);
      }
    }
    return attached;
  }

  /** Soft-delete an entity, its facts, and the unpublished entities attached to
   *  it. One level deep, since those hold a single edge. */
  async function softDeleteCascade(
    type: EntityType,
    id: string,
  ): Promise<void> {
    const attached = await attachedUnpublished(type, id);
    await softDelete(type, id);
    await removeFacts(type, id);
    for (const other of attached) {
      await softDelete(other.type, other.id);
      await removeFacts(other.type, other.id);
    }
  }

  /** Publish an entity that just gained a fact of its own. Transaction-free, so
   *  it lands with the write that triggered it. */
  async function publishIfUnpublished(
    type: EntityType,
    id: string,
  ): Promise<void> {
    const entity = await resolve(type, id);
    if (entity === undefined || isPublished(entity.standing)) return;
    if (type === "person") {
      await people.update(id, { standing: "published" });
    } else {
      await pets.update(id, { standing: "published" });
    }
  }

  return {
    resolve,
    label,
    softDelete,
    removeFacts,
    attachedUnpublished,
    softDeleteCascade,
    publishIfUnpublished,

    /** Milestones and observances also bear on relationships, which have no
     *  standing of their own; only a person or a pet can be promoted. */
    publishBearerIfUnpublished: (type: string, id: string): Promise<void> =>
      type === "person" || type === "pet"
        ? publishIfUnpublished(type, id)
        : Promise.resolve(),

    /** Absorb `loser` into `survivor` in one transaction: re-point every fact,
     *  then tombstone the loser. The survivor's own fields win as they are. */
    mergePeople: async (survivorId: string, loserId: string): Promise<void> => {
      if (survivorId === loserId) {
        throw new Error("mergePeople: survivor and loser are the same person");
      }
      await driver.transaction(async () => {
        await tags.repointEntity("person", loserId, survivorId);
        await relationships.repointEntity("person", loserId, survivorId);
        await dismissals.repointEntity("person", loserId, survivorId);
        await milestones.repointEntity("person", loserId, survivorId);
        await contactMethods.repointOwner("person", loserId, survivorId);
        await observances.repointBearer("person", loserId, survivorId);
        await giftRecipients.repointRecipient("person", loserId, survivorId);
        // Carry the "not a duplicate" memory across so the merge doesn't strand
        // or self-pair a rejection (it re-canonicalizes and drops self/dupes).
        await notADuplicate.repointEntity(loserId, survivorId);
        // Bump the survivor's clock so the merged survivor wins LWW against any
        // concurrent edit to the loser still in flight from another device.
        await people.update(survivorId, {});
        await people.softDelete(loserId);
      });
    },
  };
}
