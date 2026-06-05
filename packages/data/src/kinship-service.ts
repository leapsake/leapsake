import {
  type EntityType,
  type Gender,
  type Relationship,
  type RelationshipNeighbor,
  type RelationshipRole,
  composeRoles,
  genderedVariant,
  impliedGender,
  labelForRole,
} from "@leapsake/schema";
import type { DismissalsRepo } from "./dismissals-repo.js";
import type { SqliteDriver } from "./driver.js";
import type { PeopleRepo } from "./people-repo.js";
import type { PetsRepo } from "./pets-repo.js";
import type { RelationshipsRepo } from "./relationships-repo.js";

/**
 * How many *intermediate* hops the derivation walk may take. `1` gives the
 * one-hop inference in §0 (parent's sibling ⇒ uncle, etc.). This is the single
 * knob for future multi-hop: raising it lets the same generic walk + composition
 * table reach great-grandparents and cousins-of-cousins without new logic.
 */
const MAX_DEPTH = 1;

/** A gender read: the value plus whether it was stored or inferred. */
export interface GenderResult {
  value: Gender | null;
  origin: "explicit" | "derived";
}

export interface KinshipService {
  /**
   * The entity's gender. Explicit (stored on the row) when set; otherwise
   * derived from the explicitly-gendered roles on the entity's own end of its
   * relationships. Agreeing implications win; conflicting ones yield null (never
   * a guess). Derivation seeds only from explicit roles — no chaining.
   */
  genderFor(type: EntityType, id: string): Promise<GenderResult>;

  /**
   * The entity's relationships as oriented neighbors: every stored ("explicit")
   * edge, plus the ("derived") edges the one-hop inference engine computes live.
   * Derived edges that duplicate an explicit pair, are dismissed, or conflict are
   * dropped.
   */
  neighborsFor(type: EntityType, id: string): Promise<RelationshipNeighbor[]>;
}

/** A `(type, id)` map key. */
function key(type: EntityType, id: string): string {
  return `${type}:${id}`;
}

/** Orient a stored relationship to a subject: resolve the *other* end + its role. */
function orient(rel: Relationship, type: EntityType, id: string) {
  const subjectIsA = rel.aType === type && rel.aId === id;
  return {
    otherType: subjectIsA ? rel.bType : rel.aType,
    otherId: subjectIsA ? rel.bId : rel.aId,
    otherRole: subjectIsA ? rel.bRole : rel.aRole,
    otherRoleNote: subjectIsA ? rel.bRoleNote : rel.aRoleNote,
  };
}

/** The role the subject's *own* end holds in a stored relationship. */
function ownRole(rel: Relationship, type: EntityType, id: string) {
  return rel.aType === type && rel.aId === id ? rel.aRole : rel.bRole;
}

/**
 * The kinship inference engine. Pure rules live in `@leapsake/schema`; this
 * layer only fetches rows and orchestrates the compute-on-read derivations, so
 * deleting a source fact makes its implications vanish on the next read with no
 * cascade code.
 */
export function createKinshipService(
  // The service reads through the repositories; the driver is part of the
  // factory signature for symmetry with the others and future direct queries.
  _driver: SqliteDriver,
  repos: {
    people: PeopleRepo;
    pets: PetsRepo;
    relationships: RelationshipsRepo;
    dismissals: DismissalsRepo;
  },
): KinshipService {
  const { people, pets, relationships, dismissals } = repos;

  /** The entity's explicit gender, or undefined when the entity is gone. */
  async function explicitGender(
    type: EntityType,
    id: string,
  ): Promise<Gender | null | undefined> {
    if (type === "person") return (await people.get(id))?.gender;
    return (await pets.get(id))?.gender;
  }

  /** Display label for an entity, or undefined when it's gone/soft-deleted. */
  async function resolveLabel(
    type: EntityType,
    id: string,
  ): Promise<string | undefined> {
    if (type === "person") {
      const person = await people.get(id);
      return person ? `${person.firstName} ${person.lastName}` : undefined;
    }
    return (await pets.get(id))?.name;
  }

  async function genderFor(
    type: EntityType,
    id: string,
  ): Promise<GenderResult> {
    const explicit = await explicitGender(type, id);
    if (explicit) return { value: explicit, origin: "explicit" };

    // Derive from explicitly-gendered roles on the entity's own end.
    const rels = await relationships.listForEntity(type, id);
    let derived: Gender | null = null;
    for (const rel of rels) {
      const implied = impliedGender(ownRole(rel, type, id));
      if (implied === undefined) continue;
      if (derived === null) {
        derived = implied;
      } else if (derived !== implied) {
        return { value: null, origin: "derived" }; // conflict ⇒ never guess
      }
    }
    return { value: derived, origin: "derived" };
  }

  async function neighborsFor(
    type: EntityType,
    id: string,
  ): Promise<RelationshipNeighbor[]> {
    const neighbors: RelationshipNeighbor[] = [];

    // 1. Explicit edges: orient each stored relationship to the subject.
    const explicitRels = await relationships.listForEntity(type, id);
    const explicitPairs = new Set<string>();
    for (const rel of explicitRels) {
      const o = orient(rel, type, id);
      const otherLabel = await resolveLabel(o.otherType, o.otherId);
      if (otherLabel === undefined) continue; // other end gone — skip
      explicitPairs.add(key(o.otherType, o.otherId));
      const otherGender = (await genderFor(o.otherType, o.otherId)).value;
      neighbors.push({
        relationshipId: rel.id,
        otherType: o.otherType,
        otherId: o.otherId,
        otherLabel,
        otherRole: o.otherRole,
        otherRoleLabel: labelForRole(o.otherRole, otherGender),
        otherRoleNote: o.otherRoleNote,
        origin: "explicit",
      });
    }

    // 2. Derived edges: a generic depth-capped walk over explicit edges, gathering
    //    candidates whose composed role is defined. `visited` (seeded with the
    //    subject) keeps the walk cycle-safe; MAX_DEPTH bounds it.
    interface Candidate {
      otherType: EntityType;
      otherId: string;
      role: RelationshipRole; // neutral composed base
      via: { type: EntityType; id: string };
    }
    interface Frontier {
      type: EntityType;
      id: string;
      roleRelSubject: RelationshipRole;
    }

    const visited = new Set<string>([key(type, id)]);
    let frontier: Frontier[] = explicitRels
      .map((rel) => orient(rel, type, id))
      .map((o) => ({
        type: o.otherType,
        id: o.otherId,
        roleRelSubject: o.otherRole,
      }));
    const candidates: Candidate[] = [];

    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const next: Frontier[] = [];
      for (const m of frontier) {
        const mRels = await relationships.listForEntity(m.type, m.id);
        for (const rel of mRels) {
          const o = orient(rel, m.type, m.id);
          if (visited.has(key(o.otherType, o.otherId))) continue;
          const composed = composeRoles(m.roleRelSubject, o.otherRole);
          if (composed === undefined) continue;
          candidates.push({
            otherType: o.otherType,
            otherId: o.otherId,
            role: composed,
            via: { type: m.type, id: m.id },
          });
          next.push({
            type: o.otherType,
            id: o.otherId,
            roleRelSubject: composed,
          });
        }
      }
      for (const n of next) visited.add(key(n.type, n.id));
      frontier = next;
    }

    // 3. Filter the candidates.
    const activeDismissals = await dismissals.listForEntity(type, id);
    const dismissed = (
      otherType: EntityType,
      otherId: string,
      role: RelationshipRole,
    ) =>
      activeDismissals.some(
        (d) =>
          d.otherType === otherType &&
          d.otherId === otherId &&
          (d.role === null || d.role === role),
      );

    // Group surviving candidates by other entity to resolve conflicts + dedupe.
    const byOther = new Map<string, Candidate[]>();
    for (const c of candidates) {
      if (explicitPairs.has(key(c.otherType, c.otherId))) continue; // explicit wins
      if (dismissed(c.otherType, c.otherId, c.role)) continue;
      const k = key(c.otherType, c.otherId);
      const list = byOther.get(k) ?? [];
      list.push(c);
      byOther.set(k, list);
    }

    for (const list of byOther.values()) {
      const roles = new Set(list.map((c) => c.role));
      if (roles.size > 1) continue; // conflicting derived roles ⇒ omit entirely
      const candidate = list[0];
      const otherLabel = await resolveLabel(
        candidate.otherType,
        candidate.otherId,
      );
      if (otherLabel === undefined) continue;
      const viaLabel = await resolveLabel(candidate.via.type, candidate.via.id);
      if (viaLabel === undefined) continue;
      const otherGender = (
        await genderFor(candidate.otherType, candidate.otherId)
      ).value;
      neighbors.push({
        relationshipId: "",
        otherType: candidate.otherType,
        otherId: candidate.otherId,
        otherLabel,
        otherRole: genderedVariant(candidate.role, otherGender),
        otherRoleLabel: labelForRole(candidate.role, otherGender),
        otherRoleNote: null,
        origin: "derived",
        derivedVia: {
          type: candidate.via.type,
          id: candidate.via.id,
          label: viaLabel,
        },
      });
    }

    return neighbors;
  }

  return { genderFor, neighborsFor };
}
