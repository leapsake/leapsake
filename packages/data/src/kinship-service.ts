import {
  type EntityType,
  type Gender,
  type Person,
  type Pet,
  type Relationship,
  type RelationshipNeighbor,
  type RelationshipRole,
  composeRoles,
  entityLabel,
  genderedVariant,
  impliedGender,
  isPublished,
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

  /** The row behind an endpoint, or undefined when it's gone/soft-deleted. Note
   *  `get` does not filter on standing, so an unpublished endpoint resolves here
   *  like any other — this service is reached from the page it appears on. */
  async function getEntity(
    type: EntityType,
    id: string,
  ): Promise<Person | Pet | undefined> {
    return type === "person" ? people.get(id) : pets.get(id);
  }

  /** The entity's explicit gender, or undefined when the entity is gone. */
  async function explicitGender(
    type: EntityType,
    id: string,
  ): Promise<Gender | null | undefined> {
    return (await getEntity(type, id))?.gender;
  }

  /** Display label for an entity, or undefined when it's gone/soft-deleted. */
  async function resolveLabel(
    type: EntityType,
    id: string,
  ): Promise<string | undefined> {
    const entity = await getEntity(type, id);
    // Through `entityLabel` rather than interpolating the name parts: every part
    // is optional, so a surname-less person built by hand here would come out as
    // " Dakin" — with a leading space, on every relationship row that names them.
    return entity === undefined ? undefined : entityLabel(type, entity);
  }

  /**
   * Whether an endpoint is one of the user's own entities, and so eligible to
   * take part in inference. An unpublished entity is not: it exists as a fact
   * about the one person it is attached to, and belongs on that person's page
   * alone. Left out of the walk in both directions — never a destination, never
   * a route.
   *
   * This bites today. `compositionTable` composes `(parent, sibling) → pibling`,
   * so an unpublished sibling of someone's parent would otherwise surface as a
   * derived aunt or uncle on that someone's page — a second page, which is the
   * whole thing the standing is meant to prevent.
   *
   * It also forecloses a worse version. The table deliberately omits
   * `(parent, spouse) → parent`, noting it as a future addition; if that lands,
   * every unpublished spouse becomes a derived parent of their partner's
   * children. That inference is unsound anyway — Ernie's wife need not be the
   * mother of Ernie's son — but this rule means adding it cannot leak an
   * unpublished person onto anyone's page regardless.
   */
  async function takesPartInInference(
    type: EntityType,
    id: string,
  ): Promise<boolean> {
    const entity = await getEntity(type, id);
    return entity !== undefined && isPublished(entity.standing);
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

    // 1. Explicit edges: orient each stored relationship to the subject. These
    //    are shown whatever the other end's standing — an unpublished entity
    //    appears here, on the page of the one person it is a fact about, and
    //    nowhere else.
    const explicitRels = await relationships.listForEntity(type, id);
    const explicitPairs = new Set<string>();
    // Which of the subject's own neighbours are unpublished, noted while we have
    // each row in hand so the derivation walk below needs no further reads.
    const inertNeighbors = new Set<string>();
    for (const rel of explicitRels) {
      const o = orient(rel, type, id);
      const other = await getEntity(o.otherType, o.otherId);
      if (other === undefined) continue; // other end gone — skip
      if (!isPublished(other.standing)) {
        inertNeighbors.add(key(o.otherType, o.otherId));
      }
      explicitPairs.add(key(o.otherType, o.otherId));
      const otherGender = (await genderFor(o.otherType, o.otherId)).value;
      neighbors.push({
        relationshipId: rel.id,
        otherType: o.otherType,
        otherId: o.otherId,
        otherLabel: entityLabel(o.otherType, other),
        otherStanding: other.standing,
        otherRole: o.otherRole,
        otherRoleLabel: labelForRole(o.otherRole, otherGender),
        otherRoleNote: o.otherRoleNote,
        origin: "explicit",
      });
    }

    // An unpublished subject stops here, with its one explicit edge. The rule is
    // symmetric — such an entity is no more a *subject* of inference than a
    // destination of it — and without this, opening the page of someone who is
    // barely more than a name on a relationship would offer them a derived niece
    // and nephew inferred through the one person they hang off.
    if (!(await takesPartInInference(type, id))) return neighbors;

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
      // An unpublished neighbour is not a route. Under the one-edge rule it could
      // not lead anywhere new anyway (its only edge is the one back to the
      // subject, which `visited` already blocks), so this is belt-and-braces —
      // but it states the rule where a reader will look for it, and it holds even
      // for a row that somehow carries a second edge.
      .filter((o) => !inertNeighbors.has(key(o.otherType, o.otherId)))
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
          // ...and not a destination — see `takesPartInInference`. Without this,
          // an unpublished sibling of a parent composes into a derived pibling and
          // shows up on a second person's page.
          if (!(await takesPartInInference(o.otherType, o.otherId))) continue;
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
        // Always published: the walk above admits no other kind of endpoint.
        otherStanding: "published",
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
