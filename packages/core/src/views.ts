import type { GenderResult } from "@leapsake/data";
import type {
  ContactMethod,
  ContactOwnerType,
  EntityType,
  Milestone,
  MilestoneSubjectType,
  MilestoneTimelineEntry,
  Person,
  Pet,
  Relationship,
  RelationshipNeighbor,
  RelationshipRole,
  Tag,
} from "@leapsake/schema";
import { baseRole, entityLabel, roleDefs } from "@leapsake/schema";

// ── View-model contracts ─────────────────────────────────────────────────────
// Plain-data shapes the view builders return. They are the canonical contract
// every client renders against, so they live here (carried out to clients via
// `CoreApi`) rather than being re-declared per client.

/** A person or pet reduced to its display label — one row of a combined list. */
export interface EntityRow {
  type: EntityType;
  id: string;
  label: string;
}

/** A pickable other end for the add-relationship typeahead. */
export interface RelationshipCandidate {
  type: EntityType;
  id: string;
  label: string;
}

/** An entity (person/pet) resolved to `{type, id, label}` for headers/breadcrumbs. */
export interface EntityRef {
  type: EntityType;
  id: string;
  label: string;
}

/** A milestone subject (person, pet, or relationship) resolved for display. */
export interface MilestoneSubject {
  type: MilestoneSubjectType;
  id: string;
  label: string;
}

/** One endpoint of a relationship as shown on the relationship detail page. */
export interface RelationshipViewPartner {
  type: EntityType;
  id: string;
  label: string;
  roleLabel: string;
}

/** One endpoint of a relationship for the relationship-scoped edit/delete screens. */
export interface RelationshipPartner {
  type: EntityType;
  id: string;
  label: string;
  role: RelationshipRole;
  roleLabel: string;
  roleNote: string | null;
}

/** A Person plus its tags, derived gender, neighbors, timeline, and contacts. */
export interface PersonView {
  person: Person;
  tags: Tag[];
  relationships: RelationshipNeighbor[];
  gender: GenderResult;
  timeline: MilestoneTimelineEntry[];
  contactMethods: ContactMethod[];
}

/** A Pet plus its tags, derived gender, neighbors, and timeline. */
export interface PetView {
  pet: Pet;
  tags: Tag[];
  relationships: RelationshipNeighbor[];
  gender: GenderResult;
  timeline: MilestoneTimelineEntry[];
}

/** The subject plus the candidate list for the add-relationship screen. */
export interface RelationshipNewView {
  subject: EntityRef;
  candidates: RelationshipCandidate[];
}

/** The relationship detail page: the edge, both partners, a title, and milestones. */
export interface RelationshipView {
  relationship: Relationship;
  partners: RelationshipViewPartner[];
  title: string;
  milestones: Milestone[];
}

/** The relationship-scoped edit/delete view: both endpoints with their own roles. */
export interface RelationshipPartnersView {
  relationshipId: string;
  title: string;
  partners: [RelationshipPartner, RelationshipPartner];
}

/** A subject-scoped relationship (an explicit neighbor found by id). */
export interface RelationshipForSubjectView {
  subject: EntityRef;
  neighbor: RelationshipNeighbor;
}

/** A subject-scoped derived relationship, found by its other endpoint + base role. */
export interface DerivedRelationshipView {
  subject: EntityRef;
  neighbor: RelationshipNeighbor;
  role: RelationshipRole;
}

/**
 * The add-milestone view. From a Person the relationship-kind milestones need a
 * "with whom?" step, so the candidate list and the person's explicit neighbors
 * are included; other subject types omit them.
 */
export interface MilestoneNewView {
  subject: MilestoneSubject;
  candidates?: RelationshipCandidate[];
  neighbors?: RelationshipNeighbor[];
}

/**
 * The read-side dependencies the view builders compose over. Each is a method on
 * the already-wired core surface (or a building block from `@leapsake/data`),
 * passed in so the builders stay free of any driver/transport concern.
 */
export interface ViewsDeps {
  people: {
    list(): Promise<Person[]>;
    get(id: string): Promise<Person | undefined>;
  };
  pets: {
    list(): Promise<Pet[]>;
    get(id: string): Promise<Pet | undefined>;
  };
  listTags(type: EntityType, id: string): Promise<Tag[]>;
  getRelationship(id: string): Promise<Relationship | undefined>;
  listMilestones(type: MilestoneSubjectType, id: string): Promise<Milestone[]>;
  /** The subject's explicit neighbors, oriented + label/role resolved. */
  orientedNeighbors(
    type: EntityType,
    id: string,
  ): Promise<RelationshipNeighbor[]>;
  /** The subject's explicit + derived neighbors. */
  neighborsFor(type: EntityType, id: string): Promise<RelationshipNeighbor[]>;
  genderFor(type: EntityType, id: string): Promise<GenderResult>;
  timelineFor(type: EntityType, id: string): Promise<MilestoneTimelineEntry[]>;
  listContactMethods(
    type: ContactOwnerType,
    id: string,
  ): Promise<ContactMethod[]>;
  /** Display label for a person/pet, or undefined when the entity is gone. */
  resolveLabel(type: EntityType, id: string): Promise<string | undefined>;
}

/**
 * Build the `views` namespace: read-and-compose builders that return plain data
 * for every client to render. They own the portable fan-outs, label resolution,
 * candidate lists, and relationship-orientation reads the desktop renderer's
 * router loaders used to carry — so a second client reuses them rather than
 * rewriting them. Each builder returns `null` when its root entity is missing;
 * the caller maps that to its own not-found handling (e.g. an HTTP 404).
 */
export function createViews(deps: ViewsDeps) {
  // A person/pet's display label with a placeholder when it has been deleted —
  // used for the two-sided relationship label so a missing end reads "(unknown)"
  // rather than vanishing.
  async function displayLabel(type: EntityType, id: string): Promise<string> {
    return (await deps.resolveLabel(type, id)) ?? "(unknown)";
  }

  // A relationship's two-sided label from its endpoints, e.g. "Jane Doe & John Doe".
  async function relationshipLabel(rel: Relationship): Promise<string> {
    const [a, b] = await Promise.all([
      displayLabel(rel.aType, rel.aId),
      displayLabel(rel.bType, rel.bId),
    ]);
    return `${a} & ${b}`;
  }

  async function getEntity(
    type: EntityType,
    id: string,
  ): Promise<Person | Pet | undefined> {
    return type === "person" ? deps.people.get(id) : deps.pets.get(id);
  }

  async function entityRef(
    type: EntityType,
    id: string,
  ): Promise<EntityRef | null> {
    const entity = await getEntity(type, id);
    return entity ? { type, id, label: entityLabel(type, entity) } : null;
  }

  async function candidates(exclude?: {
    type: EntityType;
    id: string;
  }): Promise<RelationshipCandidate[]> {
    const [people, pets] = await Promise.all([
      deps.people.list(),
      deps.pets.list(),
    ]);
    return [
      ...people
        .filter((p) => !(exclude?.type === "person" && p.id === exclude.id))
        .map((p) => ({
          type: "person" as const,
          id: p.id,
          label: entityLabel("person", p),
        })),
      ...pets
        .filter((p) => !(exclude?.type === "pet" && p.id === exclude.id))
        .map((p) => ({
          type: "pet" as const,
          id: p.id,
          label: entityLabel("pet", p),
        })),
    ];
  }

  async function milestoneSubject(
    subjectType: MilestoneSubjectType,
    id: string,
  ): Promise<MilestoneSubject | undefined> {
    if (subjectType === "relationship") {
      const rel = await deps.getRelationship(id);
      return rel
        ? { type: subjectType, id, label: await relationshipLabel(rel) }
        : undefined;
    }
    const entity = await getEntity(subjectType, id);
    return entity
      ? { type: subjectType, id, label: entityLabel(subjectType, entity) }
      : undefined;
  }

  return {
    /** The combined People & Pets home list, merged and sorted by display name. */
    entityList: async (): Promise<EntityRow[]> => {
      const [people, pets] = await Promise.all([
        deps.people.list(),
        deps.pets.list(),
      ]);
      const rows: EntityRow[] = [
        ...people.map((p) => ({
          type: "person" as const,
          id: p.id,
          label: entityLabel("person", p),
        })),
        ...pets.map((p) => ({
          type: "pet" as const,
          id: p.id,
          label: entityLabel("pet", p),
        })),
      ];
      return [...rows].sort((a, b) => a.label.localeCompare(b.label));
    },

    /**
     * All people and pets as relationship candidates, optionally excluding one
     * entity (the subject, when adding from its own page).
     */
    candidates,

    /** The subject plus its candidate list for the add-relationship screen. */
    relationshipNew: async (
      subjectType: EntityType,
      id: string,
    ): Promise<RelationshipNewView | null> => {
      const subject = await entityRef(subjectType, id);
      if (!subject) return null;
      return {
        subject,
        candidates: await candidates({ type: subjectType, id }),
      };
    },

    /** A Person plus its tags, derived gender, neighbors, timeline, and contacts. */
    person: async (id: string): Promise<PersonView | null> => {
      const person = await deps.people.get(id);
      if (!person) return null;
      const [tags, relationships, gender, timeline, contactMethods] =
        await Promise.all([
          deps.listTags("person", id),
          deps.neighborsFor("person", id),
          deps.genderFor("person", id),
          deps.timelineFor("person", id),
          deps.listContactMethods("person", id),
        ]);
      return { person, tags, relationships, gender, timeline, contactMethods };
    },

    /** A Pet plus its tags, derived gender, neighbors, and timeline. */
    pet: async (id: string): Promise<PetView | null> => {
      const pet = await deps.pets.get(id);
      if (!pet) return null;
      const [tags, relationships, gender, timeline] = await Promise.all([
        deps.listTags("pet", id),
        deps.neighborsFor("pet", id),
        deps.genderFor("pet", id),
        deps.timelineFor("pet", id),
      ]);
      return { pet, tags, relationships, gender, timeline };
    },

    /** The relationship detail page: the edge, both partners, title, milestones. */
    relationship: async (id: string): Promise<RelationshipView | null> => {
      const relationship = await deps.getRelationship(id);
      if (!relationship) return null;
      const [aLabel, bLabel, milestones] = await Promise.all([
        displayLabel(relationship.aType, relationship.aId),
        displayLabel(relationship.bType, relationship.bId),
        deps.listMilestones("relationship", id),
      ]);
      const partners: RelationshipViewPartner[] = [
        {
          type: relationship.aType,
          id: relationship.aId,
          label: aLabel,
          roleLabel: roleDefs[relationship.aRole].label,
        },
        {
          type: relationship.bType,
          id: relationship.bId,
          label: bLabel,
          roleLabel: roleDefs[relationship.bRole].label,
        },
      ];
      return {
        relationship,
        partners,
        title: `${aLabel} & ${bLabel}`,
        milestones,
      };
    },

    /** Both endpoints with their own roles, for the relationship-scoped screens. */
    relationshipPartners: async (
      id: string,
    ): Promise<RelationshipPartnersView | null> => {
      const relationship = await deps.getRelationship(id);
      if (!relationship) return null;
      const [aLabel, bLabel] = await Promise.all([
        displayLabel(relationship.aType, relationship.aId),
        displayLabel(relationship.bType, relationship.bId),
      ]);
      const partners: [RelationshipPartner, RelationshipPartner] = [
        {
          type: relationship.aType,
          id: relationship.aId,
          label: aLabel,
          role: relationship.aRole,
          roleLabel: roleDefs[relationship.aRole].label,
          roleNote: relationship.aRoleNote,
        },
        {
          type: relationship.bType,
          id: relationship.bId,
          label: bLabel,
          role: relationship.bRole,
          roleLabel: roleDefs[relationship.bRole].label,
          roleNote: relationship.bRoleNote,
        },
      ];
      return { relationshipId: id, title: `${aLabel} & ${bLabel}`, partners };
    },

    /** A subject-scoped explicit relationship, found among the subject's neighbors. */
    relationshipForSubject: async (
      subjectType: EntityType,
      id: string,
      relId: string,
    ): Promise<RelationshipForSubjectView | null> => {
      const subject = await entityRef(subjectType, id);
      if (!subject) return null;
      const neighbors = await deps.orientedNeighbors(subjectType, id);
      const neighbor = neighbors.find((n) => n.relationshipId === relId);
      return neighbor ? { subject, neighbor } : null;
    },

    /**
     * A subject-scoped derived relationship. A derived edge has no stored row, so
     * it is identified by its other endpoint + base role; we recompute the
     * subject's neighbors and find the matching derived one.
     */
    derivedRelationship: async (
      subjectType: EntityType,
      id: string,
      otherType: EntityType,
      otherId: string,
      role: RelationshipRole,
    ): Promise<DerivedRelationshipView | null> => {
      const subject = await entityRef(subjectType, id);
      if (!subject) return null;
      const neighbors = await deps.neighborsFor(subjectType, id);
      const neighbor = neighbors.find(
        (n) =>
          n.origin === "derived" &&
          n.otherType === otherType &&
          n.otherId === otherId &&
          baseRole(n.otherRole) === role,
      );
      return neighbor ? { subject, neighbor, role } : null;
    },

    /** A milestone subject (person, pet, or relationship) resolved for display. */
    milestoneSubject,

    /**
     * The add-milestone view. From a Person, also loads the candidate list and
     * the person's explicit neighbors for the "with whom?" step.
     */
    milestoneNew: async (
      subjectType: MilestoneSubjectType,
      id: string,
    ): Promise<MilestoneNewView | null> => {
      const subject = await milestoneSubject(subjectType, id);
      if (!subject) return null;
      if (subjectType !== "person") return { subject };
      const [cands, neighbors] = await Promise.all([
        candidates({ type: "person", id }),
        deps.orientedNeighbors("person", id),
      ]);
      return { subject, candidates: cands, neighbors };
    },
  };
}
