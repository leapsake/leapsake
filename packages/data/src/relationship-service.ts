import {
  type EntityType,
  type Person,
  type Pet,
  type Relationship,
  type RelationshipNeighbor,
  type RelationshipRole,
  entityLabel,
  genderedVariant,
  impliedGender,
  inverseRole,
  relationshipPairLabel,
  roleDefs,
  splitName,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import type { EntityService } from "./entity-service.js";
import type { PeopleRepo } from "./people-repo.js";
import type { PetsRepo } from "./pets-repo.js";
import type { RelationshipsRepo } from "./relationships-repo.js";
import type { SelfPersonRepo } from "./self-person-repo.js";

/** A relationship's two endpoints as `(type, id)` pairs; `[]` when it is gone. */
export function endpointsOf(
  rel: Relationship | undefined,
): { type: EntityType; id: string }[] {
  return rel === undefined
    ? []
    : [
        { type: rel.aType, id: rel.aId },
        { type: rel.bType, id: rel.bId },
      ];
}

export interface RelationshipServiceDeps {
  people: PeopleRepo;
  pets: PetsRepo;
  relationships: RelationshipsRepo;
  self: SelfPersonRepo;
  entities: EntityService;
  /** Each write below is one transaction. */
  driver: SqliteDriver;
}

export interface RelationshipService {
  /**
   * Orient each stored row touching the subject and resolve the *other* end's
   * label + role, so callers never see the raw a/b endpoints.
   */
  orientedNeighbors(
    type: EntityType,
    id: string,
  ): Promise<RelationshipNeighbor[]>;
  /**
   * What to call a milestone borne by a **relationship** — "Harry & Tilly", or
   * just "Violet" for a relationship the self-person is one end of, since a
   * reminder about your own anniversary is addressed to you and names your
   * partner.
   *
   * `null` only when there is no name left to use: the relationship is gone, or
   * both its endpoints are. That distinction is load-bearing — the reminder
   * engine reads a null label as "the bearer is gone" and skips the milestone.
   */
  label(id: string): Promise<string | null>;
  createFromSubject(input: {
    subjectType: EntityType;
    subjectId: string;
    otherType: EntityType;
    otherId: string;
    otherRole: RelationshipRole;
    otherRoleNote?: string | null;
  }): Promise<Relationship>;
  createWithNewOther(input: {
    subjectType: EntityType;
    subjectId: string;
    otherType: EntityType;
    otherName: string;
    otherRole: RelationshipRole;
    otherRoleNote?: string | null;
  }): Promise<{ other: Person | Pet; relationship: Relationship }>;
  editFromSubject(input: {
    subjectType: EntityType;
    subjectId: string;
    relId: string;
    otherRole: RelationshipRole;
    otherRoleNote: string | null;
  }): Promise<Relationship | undefined>;
}

/**
 * Creating and editing edges in the relationship graph, and reading one back
 * oriented around a subject.
 *
 * Distinct from `createKinshipService`, which *derives* over the graph
 * (inferred neighbors, gender). This one writes it, and owns the single rule
 * every writing path shares: a subject's own role is the gender-neutral inverse
 * of the role it gives the other end.
 */
export function createRelationshipService(
  deps: RelationshipServiceDeps,
): RelationshipService {
  const { people, pets, relationships, self, entities, driver } = deps;

  async function orientedNeighbors(
    type: EntityType,
    id: string,
  ): Promise<RelationshipNeighbor[]> {
    const rows = await relationships.listForEntity(type, id);
    const neighbors: RelationshipNeighbor[] = [];
    for (const rel of rows) {
      const subjectIsA = rel.aType === type && rel.aId === id;
      const otherType = subjectIsA ? rel.bType : rel.aType;
      const otherId = subjectIsA ? rel.bId : rel.aId;
      const otherRole = subjectIsA ? rel.bRole : rel.aRole;
      const otherRoleNote = subjectIsA ? rel.bRoleNote : rel.aRoleNote;
      const other = await entities.resolve(otherType, otherId);
      if (other === undefined) continue; // other end gone — skip
      neighbors.push({
        relationshipId: rel.id,
        otherType,
        otherId,
        otherLabel: entityLabel(otherType, other),
        otherStanding: other.standing,
        otherRole,
        otherRoleLabel: roleDefs[otherRole].label,
        otherRoleNote,
        origin: "explicit",
      });
    }
    return neighbors;
  }

  async function label(id: string): Promise<string | null> {
    const rel = await relationships.get(id);
    if (rel === undefined) return null;
    const selfId = (await self.getSelf())?.personId;
    const ends = endpointsOf(rel).filter(
      (e) => !(e.type === "person" && e.id === selfId),
    );
    const named = (
      await Promise.all(ends.map((e) => entities.label(e.type, e.id)))
    ).filter((name): name is string => name !== undefined);
    if (named.length === 0) return null;
    // One name is the ordinary case for a relationship you are in, and also what
    // a half-deleted pair degrades to — better a reminder naming whoever is left
    // than none at all.
    return named.length === 1
      ? named[0]
      : relationshipPairLabel(named[0], named[1]);
  }

  return {
    orientedNeighbors,
    label,

    // A relationship written from a subject's perspective: the subject is the `a`
    // endpoint, and its own role is the gender-neutral inverse of the chosen other
    // role. This is the single home for the "imply my role from the other end"
    // rule, shared by the add-from-subject, create-form, and derived-materialise
    // paths so no client re-derives it.
    createFromSubject: (input) =>
      driver.transaction(async () => {
        const created = await relationships.create({
          aType: input.subjectType,
          aId: input.subjectId,
          aRole: inverseRole(input.otherRole),
          bType: input.otherType,
          bId: input.otherId,
          bRole: input.otherRole,
          bRoleNote: input.otherRoleNote ?? null,
        });
        // An unpublished entity holds exactly one relationship — the one it was
        // created with. Either end reaching here is therefore an end acquiring a
        // *second*, which is a connection of its own and more than being a name on
        // somebody else's page. Note this is how the invariant is kept: by
        // promoting, not by refusing. `createWithNewOther` writes the first edge
        // without coming through here, which is why it doesn't trip this.
        await entities.publishIfUnpublished(input.subjectType, input.subjectId);
        await entities.publishIfUnpublished(input.otherType, input.otherId);
        return created;
      }),

    /**
     * Record a relationship to somebody who isn't in the user's list — creating
     * them, unpublished, as part of the same write.
     *
     * This is the way an unpublished entity comes into being, and the only one:
     * you type a name into the relationship form, nothing matches it, and you save.
     * What you get is a person (or pet) that exists as a fact about the subject —
     * absent from People & Pets, from every picker, and from duplicate detection —
     * plus the single relationship that is their entire reason for being there.
     *
     * One transaction, because half of this is nothing: an entity with no edge is
     * unreachable, and an edge to nobody is not writable.
     *
     * The name is taken **verbatim** for a pet and split on the first space for a
     * person, the same rule the vCard reader falls back on for a bare `FN`. Nothing
     * cleverer: "Ruth" and "Ruth Dakin" are both whole names now, so there is no
     * missing part to guess at, and a two-word name that isn't first-and-last is
     * one edit away from being right on the person's own page.
     */
    createWithNewOther: (input) =>
      driver.transaction(async () => {
        const name = input.otherName.trim();
        const other =
          input.otherType === "person"
            ? await people.create({
                ...splitName(name),
                standing: "unpublished",
              })
            : await pets.create({ name, standing: "unpublished" });
        const relationship = await relationships.create({
          aType: input.subjectType,
          aId: input.subjectId,
          aRole: inverseRole(input.otherRole),
          bType: input.otherType,
          bId: other.id,
          bRole: input.otherRole,
          bRoleNote: input.otherRoleNote ?? null,
        });
        return { other, relationship };
      }),

    // Edit a subject-scoped relationship: only the *other* end's role changes; the
    // subject's own role re-derives as the neutral inverse but keeps the gendering
    // it already had (so editing a wife→husband couple doesn't flatten the unedited
    // "husband" back to "spouse"). The stored row may hold the subject on either
    // end, so we fetch it to learn the orientation before mapping roles onto a/b.
    editFromSubject: (input) =>
      driver.transaction(async () => {
        const rel = await relationships.get(input.relId);
        if (!rel) return undefined;
        const subjectIsA =
          rel.aType === input.subjectType && rel.aId === input.subjectId;
        const subjectRole = genderedVariant(
          inverseRole(input.otherRole),
          impliedGender(subjectIsA ? rel.aRole : rel.bRole),
        );
        return relationships.update(
          input.relId,
          subjectIsA
            ? {
                aRole: subjectRole,
                aRoleNote: null,
                bRole: input.otherRole,
                bRoleNote: input.otherRoleNote,
              }
            : {
                aRole: input.otherRole,
                aRoleNote: input.otherRoleNote,
                bRole: subjectRole,
                bRoleNote: null,
              },
        );
      }),
  };
}
