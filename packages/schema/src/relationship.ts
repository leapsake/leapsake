import { z } from "zod";

/**
 * The kinds of entity a relationship can connect. Both values are defined up
 * front so the schema is stable as new entities arrive; only `person` is
 * reachable until Pets ship (reboot follow-up). Every relationship endpoint is a
 * `(type, id)` pair — the same polymorphic shape as `taggings` — so a new entity
 * type joins the graph without a schema change.
 */
export const entityTypeSchema = z.enum(["person", "pet"]);

export type EntityType = z.infer<typeof entityTypeSchema>;

/**
 * The closed set of relationship roles. Deliberately gender-neutral so the data
 * stays uniform and queryable ("everyone who is a parent") — we avoid the
 * "Mom/Mother/Ma" fan-out by not having gendered terms at all yet. `other` is the
 * escape hatch and carries an optional free-text note so it isn't a black hole.
 */
export const relationshipRoleSchema = z.enum([
  "parent",
  "child",
  "sibling",
  "spouse",
  "partner",
  "friend",
  "cousin",
  "coworker",
  "classmate",
  "neighbor",
  "grandparent",
  "grandchild",
  "owner",
  "pet",
  "other",
]);

export type RelationshipRole = z.infer<typeof relationshipRoleSchema>;

/** Static metadata for a role: how it displays, its inverse, and who may hold it. */
export interface RoleDef {
  /** Display label, e.g. "Parent". */
  label: string;
  /**
   * The role on the other end. Symmetric roles (friend, sibling) are their own
   * inverse. Gender-neutral, so `parent` ↔ `child` rather than mother/son; a user
   * can refine a stored role to something more specific later.
   */
  inverse: RelationshipRole;
  /**
   * Which entity types may *hold* this role. `"any"` for everything except the
   * pet-ownership pair, where `owner` must be a person and `pet` must be a pet.
   */
  holderTypes: EntityType[] | "any";
}

/**
 * The role registry. The inverse links power the "type one role, the other end
 * auto-fills" UX; `holderTypes` constrains the owner/pet pair and is enforced by
 * the schema refinements below. Insertion order is the UI listing order.
 */
export const roleDefs: Record<RelationshipRole, RoleDef> = {
  parent: { label: "Parent", inverse: "child", holderTypes: "any" },
  child: { label: "Child", inverse: "parent", holderTypes: "any" },
  sibling: { label: "Sibling", inverse: "sibling", holderTypes: "any" },
  spouse: { label: "Spouse", inverse: "spouse", holderTypes: "any" },
  partner: { label: "Partner", inverse: "partner", holderTypes: "any" },
  friend: { label: "Friend", inverse: "friend", holderTypes: "any" },
  cousin: { label: "Cousin", inverse: "cousin", holderTypes: "any" },
  coworker: { label: "Coworker", inverse: "coworker", holderTypes: "any" },
  classmate: { label: "Classmate", inverse: "classmate", holderTypes: "any" },
  neighbor: { label: "Neighbor", inverse: "neighbor", holderTypes: "any" },
  grandparent: {
    label: "Grandparent",
    inverse: "grandchild",
    holderTypes: "any",
  },
  grandchild: {
    label: "Grandchild",
    inverse: "grandparent",
    holderTypes: "any",
  },
  owner: { label: "Owner", inverse: "pet", holderTypes: ["person"] },
  pet: { label: "Pet", inverse: "owner", holderTypes: ["pet"] },
  other: { label: "Other", inverse: "other", holderTypes: "any" },
};

/** The {@link RoleDef} for a role, or undefined if it isn't a known role. */
export function getRoleDef(role: string): RoleDef | undefined {
  return Object.hasOwn(roleDefs, role)
    ? roleDefs[role as RelationshipRole]
    : undefined;
}

/** The gender-neutral inverse of a role (its own inverse when symmetric). */
export function inverseRole(role: RelationshipRole): RelationshipRole {
  return roleDefs[role].inverse;
}

/** Whether `type` is allowed to hold `role` (owner=person, pet=pet, else any). */
export function holderAllows(
  role: RelationshipRole,
  type: EntityType,
): boolean {
  const def = roleDefs[role];
  return def.holderTypes === "any" || def.holderTypes.includes(type);
}

/** Roles a given entity type may hold, in registry order — drives the role picker. */
export function rolesForHolder(
  type: EntityType,
): { role: RelationshipRole; label: string }[] {
  return (Object.keys(roleDefs) as RelationshipRole[])
    .filter((role) => holderAllows(role, type))
    .map((role) => ({ role, label: roleDefs[role].label }));
}

/**
 * A Relationship — one directed edge stored as a single row holding *both*
 * endpoints and *both* roles, e.g. {a: Alice/parent, b: Bob/child}. One row per
 * relationship keeps it a single fact to create, soft-delete, and (V3) sync,
 * unlike a mirrored two-row model. There is intentionally no unique constraint
 * on the pair: the same two entities may relate in more than one way.
 *
 * Same sync-safe conventions as Person (reboot-plan.md §4.2): client UUID id,
 * epoch-ms UTC timestamps, nullable `deletedAt`.
 */
export const relationshipSchema = z
  .object({
    id: z.uuid(),
    aType: entityTypeSchema,
    aId: z.uuid(),
    aRole: relationshipRoleSchema,
    aRoleNote: z.string().min(1).nullable(), // only when aRole === "other"
    bType: entityTypeSchema,
    bId: z.uuid(),
    bRole: relationshipRoleSchema,
    bRoleNote: z.string().min(1).nullable(),
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(),
    deletedAt: z.number().int().nullable(),
  })
  .refine((d) => d.aRole === "other" || d.aRoleNote === null, {
    message: "aRoleNote is only allowed when aRole is 'other'",
    path: ["aRoleNote"],
  })
  .refine((d) => d.bRole === "other" || d.bRoleNote === null, {
    message: "bRoleNote is only allowed when bRole is 'other'",
    path: ["bRoleNote"],
  })
  .refine((d) => holderAllows(d.aRole, d.aType), {
    message: "aType is not allowed to hold aRole",
    path: ["aRole"],
  })
  .refine((d) => holderAllows(d.bRole, d.bType), {
    message: "bType is not allowed to hold bRole",
    path: ["bRole"],
  });

export type Relationship = z.infer<typeof relationshipSchema>;

/** The two endpoints + roles accepted when creating a relationship. */
export const createRelationshipInputSchema = z
  .object({
    aType: entityTypeSchema,
    aId: z.uuid(),
    aRole: relationshipRoleSchema,
    aRoleNote: z.string().min(1).nullable().optional(),
    bType: entityTypeSchema,
    bId: z.uuid(),
    bRole: relationshipRoleSchema,
    bRoleNote: z.string().min(1).nullable().optional(),
  })
  .refine((d) => d.aRole === "other" || (d.aRoleNote ?? null) === null, {
    message: "aRoleNote is only allowed when aRole is 'other'",
    path: ["aRoleNote"],
  })
  .refine((d) => d.bRole === "other" || (d.bRoleNote ?? null) === null, {
    message: "bRoleNote is only allowed when bRole is 'other'",
    path: ["bRoleNote"],
  })
  .refine((d) => holderAllows(d.aRole, d.aType), {
    message: "aType is not allowed to hold aRole",
    path: ["aRole"],
  })
  .refine((d) => holderAllows(d.bRole, d.bType), {
    message: "bType is not allowed to hold bRole",
    path: ["bRole"],
  });

export type CreateRelationshipInput = z.infer<
  typeof createRelationshipInputSchema
>;

/**
 * Editable fields when updating a relationship: the roles and notes only — the
 * endpoints are immutable once created (delete and recreate to re-point). The
 * repository merges this onto the stored row and re-validates the whole row, so
 * the note/holder rules are still enforced after a partial update.
 */
export const updateRelationshipInputSchema = z.object({
  aRole: relationshipRoleSchema.optional(),
  aRoleNote: z.string().min(1).nullable().optional(),
  bRole: relationshipRoleSchema.optional(),
  bRoleNote: z.string().min(1).nullable().optional(),
});

export type UpdateRelationshipInput = z.infer<
  typeof updateRelationshipInputSchema
>;

/**
 * One relationship as seen from a subject entity: the *other* end resolved for
 * display, with that end's role. The IPC layer builds these so the renderer never
 * deals with the stored a/b orientation.
 */
export interface RelationshipNeighbor {
  relationshipId: string;
  otherType: EntityType;
  otherId: string;
  otherLabel: string;
  otherRole: RelationshipRole;
  otherRoleLabel: string;
  otherRoleNote: string | null;
}
