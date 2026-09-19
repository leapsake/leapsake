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

/** A relationship's endpoints as `(type, id)` pairs; `[]` when it is gone. */
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
  /** Each stored row touching the subject, oriented, with the other end's label
   *  and role. */
  orientedNeighbors(
    type: EntityType,
    id: string,
  ): Promise<RelationshipNeighbor[]>;
  /** A relationship's name ("Harry & Tilly", or your partner for your own).
   *  `null` only when no name is left: the engine reads it as gone. */
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

/** Writes to the relationship graph. Owns the rule every write shares: a
 *  subject's own role is the gender-neutral inverse of the other end's. */
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
    // One name: your own relationship, or a half-deleted pair.
    return named.length === 1
      ? named[0]
      : relationshipPairLabel(named[0], named[1]);
  }

  return {
    orientedNeighbors,
    label,

    // The subject is the `a` end, its role the neutral inverse of the chosen
    // one; shared by every path so no client re-derives it.
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
        // A second relationship promotes an unpublished end;
        // `createWithNewOther` writes the first without coming through here.
        await entities.publishIfUnpublished(input.subjectType, input.subjectId);
        await entities.publishIfUnpublished(input.otherType, input.otherId);
        return created;
      }),

    /** Record a relationship to someone new, created unpublished in the same
     *  transaction (README, "Unpublished entities"). */
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

    // Only the other end's role changes; the subject's re-derives but keeps its
    // gendering. The row is fetched to learn which end is the subject.
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
