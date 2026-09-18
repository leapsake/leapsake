import {
  type EntityType,
  type Person,
  type Pet,
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

/**
 * Whether an edit to an entity's own row makes it more than a name.
 *
 * A name is the one thing an unpublished entity is *allowed* to have, so
 * correcting "Ruth" to "Ruth Dakin" leaves her exactly what she was. Anything
 * else on the row — a gender, a pet's species — is a fact of her own, and so is
 * a tag, which arrives beside the patch rather than in it.
 *
 * A patch that names `standing` itself is left alone: the caller has said what
 * they want, and inferring over the top of that would make an explicit demotion
 * impossible to write.
 */
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
  /** The row behind an endpoint, for callers that want more of it than its
   *  label — currently its `standing`. Neither `get` filters on standing, so an
   *  unpublished entity resolves here like any other. */
  resolve(type: EntityType, id: string): Promise<Person | Pet | undefined>;
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

/**
 * The cross-repo writes that treat a person or a pet as a whole: deleting one
 * along with every fact that references it, promoting one that has stopped
 * being only a fact about someone else, and merging two that turned out to be
 * the same person.
 *
 * Every method here spans repositories, which is why none of them belongs on
 * one. They sit beside `createKinshipService` and `createDuplicateService` for
 * the same reason.
 */
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

  const softDelete = (type: EntityType, id: string): Promise<void> =>
    type === "person" ? people.softDelete(id) : pets.softDelete(id);

  /**
   * Soft-delete every fact hanging off an entity.
   *
   * The list the Person and Pet cascades share, in one place so the two cannot
   * drift apart — and so the unpublished-entity cascade below sweeps exactly what
   * a deliberate delete would. Contact methods are the one asymmetry: only a
   * person owns them.
   *
   * Transaction-free, like the repo building blocks it calls; every caller is
   * already inside one.
   */
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

  /**
   * The entities that exist only because this one does: the unpublished ends of
   * its explicit relationships.
   *
   * **Must be read before the relationships are removed**, because the edge is
   * the only thing identifying such an entity as belonging to this one.
   */
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

  /**
   * Soft-delete an entity, its facts, and anyone who existed only as a fact
   * about it.
   *
   * A coworker's wife recorded as a name on his relationship is not a person the
   * user has any other way to reach; leaving her behind when he goes would strand
   * a row nothing links to. So she goes too — the deliberate counterpart of the
   * catalog rule that keeps her out of every list in the first place.
   *
   * One level deep, and that is not an approximation: an unpublished entity holds
   * exactly one explicit relationship, to a published one, so there is never a
   * second rung to walk down.
   */
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

  /**
   * Publish an entity that has just stopped being only a fact about someone else.
   *
   * The rule the whole feature turns on: an unpublished entity is one that is
   * nothing but a name on somebody's relationship, so the moment it acquires a
   * fact of its own — a birthday, a gender, a contact method, a tag, a second
   * relationship — it is no longer that, and belongs in the catalog. Every core
   * write that records such a fact calls this, which is why the user never meets
   * the idea: they fill something in, and the person is simply there afterwards.
   *
   * A no-op for the overwhelmingly common case of an already-published entity,
   * and for the derived readings (a gender inferred from a role) that store
   * nothing and so make nobody more than they were.
   *
   * Transaction-free: callers fold it into the transaction of the write that
   * triggered it, so the fact and the promotion land together or not at all.
   */
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

    /**
     * Absorb the `loser` person into the `survivor`, in one transaction: the
     * mirror of {@link EntityService.softDeleteCascade}, re-pointing every fact
     * onto the survivor instead of removing it, then tombstoning the loser. The
     * survivor's own scalar fields (name, gender) win as-is — survivorship v1
     * is deliberately blunt, with no per-field picker. Re-points bump each row's
     * updated_at and the loser's tombstone propagates, so the merge replicates
     * across devices over normal sync with no merge-specific code.
     */
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
