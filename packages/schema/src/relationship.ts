import { z } from "zod";
import type { Gender } from "./gender.js";

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
 * The closed set of relationship roles. There are two flavours:
 *
 * - **Neutral base roles** (`parent`, `child`, `sibling`, …): the canonical,
 *   gender-free roles. A subject's *own* end of a relationship is always stored
 *   as one of these, so the data stays uniform and queryable.
 * - **Gendered variants** (`father`, `mother`, `son`, …): a base role specialised
 *   to a gender. Stored only on the end the user explicitly picked; the variant
 *   *implies* its holder's gender (`father` ⇒ male), which is how a gender can be
 *   derived without ever being written explicitly.
 *
 * `pibling` (parent's sibling) and `nibling` (sibling's child) are neutral bases
 * whose only natural English labels are gendered (uncle/aunt, nephew/niece), so
 * their picker labels read "Uncle/Aunt" and "Niece/Nephew".
 *
 * `other` is the escape hatch and carries an optional free-text note so it isn't
 * a black hole. Insertion order below is the UI listing order.
 */
export const relationshipRoleSchema = z.enum([
  // Neutral base roles (existing).
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
  // Neutral base roles (new kinship bases).
  "pibling",
  "nibling",
  "parent-in-law",
  "child-in-law",
  "sibling-in-law",
  // Gendered variants.
  "father",
  "mother",
  "son",
  "daughter",
  "brother",
  "sister",
  "husband",
  "wife",
  "grandfather",
  "grandmother",
  "grandson",
  "granddaughter",
  "uncle",
  "aunt",
  "nephew",
  "niece",
  "father-in-law",
  "mother-in-law",
  "son-in-law",
  "daughter-in-law",
  "brother-in-law",
  "sister-in-law",
]);

export type RelationshipRole = z.infer<typeof relationshipRoleSchema>;

/** Static metadata for a role: how it displays, its place in the gender system, and who may hold it. */
export interface RoleDef {
  /** Display label, e.g. "Parent" or "Father". */
  label: string;
  /**
   * The neutral canonical role this is a (possibly gendered) form of. A neutral
   * role's `base` is itself; `father`/`mother` both base to `parent`.
   */
  base: RelationshipRole;
  /**
   * The gender this role implies for its holder, for gendered variants only.
   * Undefined on neutral roles (they imply nothing about gender).
   */
  gender?: Gender;
  /**
   * The role on the *other* end, defined **only on neutral base roles** and
   * always neutral (`parent` ↔ `child`, never mother/son). Symmetric roles are
   * their own inverse. Gendered variants resolve their inverse through their
   * base — see {@link inverseRole}.
   */
  inverse?: RelationshipRole;
  /**
   * Which entity types may *hold* this role. `"any"` for everything except the
   * pet-ownership pair, where `owner` must be a person and `pet` must be a pet.
   */
  holderTypes: EntityType[] | "any";
}

/**
 * The gendered-variant table: each neutral base that has gendered forms maps to
 * its `{ male, female }` specialisations. The single source of truth behind
 * {@link genderedVariant}; `roleDefs` below is kept consistent with it.
 */
const genderedVariants: Partial<
  Record<RelationshipRole, { male: RelationshipRole; female: RelationshipRole }>
> = {
  parent: { male: "father", female: "mother" },
  child: { male: "son", female: "daughter" },
  sibling: { male: "brother", female: "sister" },
  spouse: { male: "husband", female: "wife" },
  grandparent: { male: "grandfather", female: "grandmother" },
  grandchild: { male: "grandson", female: "granddaughter" },
  pibling: { male: "uncle", female: "aunt" },
  nibling: { male: "nephew", female: "niece" },
  "parent-in-law": { male: "father-in-law", female: "mother-in-law" },
  "child-in-law": { male: "son-in-law", female: "daughter-in-law" },
  "sibling-in-law": { male: "brother-in-law", female: "sister-in-law" },
};

/**
 * The role registry. Neutral roles carry an `inverse`; gendered variants carry
 * the `gender` they imply and a `base` pointing at their neutral form. The
 * `holderTypes` constraint pins the owner/pet pair (enforced by the schema
 * refinements below); kinship roles are `"any"`. Insertion order is the UI
 * listing order.
 */
export const roleDefs: Record<RelationshipRole, RoleDef> = {
  // Neutral base roles.
  parent: {
    label: "Parent",
    base: "parent",
    inverse: "child",
    holderTypes: "any",
  },
  child: {
    label: "Child",
    base: "child",
    inverse: "parent",
    holderTypes: "any",
  },
  sibling: {
    label: "Sibling",
    base: "sibling",
    inverse: "sibling",
    holderTypes: "any",
  },
  spouse: {
    label: "Spouse",
    base: "spouse",
    inverse: "spouse",
    holderTypes: "any",
  },
  partner: {
    label: "Partner",
    base: "partner",
    inverse: "partner",
    holderTypes: "any",
  },
  friend: {
    label: "Friend",
    base: "friend",
    inverse: "friend",
    holderTypes: "any",
  },
  cousin: {
    label: "Cousin",
    base: "cousin",
    inverse: "cousin",
    holderTypes: "any",
  },
  coworker: {
    label: "Coworker",
    base: "coworker",
    inverse: "coworker",
    holderTypes: "any",
  },
  classmate: {
    label: "Classmate",
    base: "classmate",
    inverse: "classmate",
    holderTypes: "any",
  },
  neighbor: {
    label: "Neighbor",
    base: "neighbor",
    inverse: "neighbor",
    holderTypes: "any",
  },
  grandparent: {
    label: "Grandparent",
    base: "grandparent",
    inverse: "grandchild",
    holderTypes: "any",
  },
  grandchild: {
    label: "Grandchild",
    base: "grandchild",
    inverse: "grandparent",
    holderTypes: "any",
  },
  owner: {
    label: "Owner",
    base: "owner",
    inverse: "pet",
    holderTypes: ["person"],
  },
  pet: { label: "Pet", base: "pet", inverse: "owner", holderTypes: ["pet"] },
  other: {
    label: "Other",
    base: "other",
    inverse: "other",
    holderTypes: "any",
  },
  pibling: {
    label: "Uncle/Aunt",
    base: "pibling",
    inverse: "nibling",
    holderTypes: "any",
  },
  nibling: {
    label: "Niece/Nephew",
    base: "nibling",
    inverse: "pibling",
    holderTypes: "any",
  },
  "parent-in-law": {
    label: "Parent-in-law",
    base: "parent-in-law",
    inverse: "child-in-law",
    holderTypes: "any",
  },
  "child-in-law": {
    label: "Child-in-law",
    base: "child-in-law",
    inverse: "parent-in-law",
    holderTypes: "any",
  },
  "sibling-in-law": {
    label: "Sibling-in-law",
    base: "sibling-in-law",
    inverse: "sibling-in-law",
    holderTypes: "any",
  },

  // Gendered variants — base + implied gender, no inverse of their own.
  father: {
    label: "Father",
    base: "parent",
    gender: "male",
    holderTypes: "any",
  },
  mother: {
    label: "Mother",
    base: "parent",
    gender: "female",
    holderTypes: "any",
  },
  son: { label: "Son", base: "child", gender: "male", holderTypes: "any" },
  daughter: {
    label: "Daughter",
    base: "child",
    gender: "female",
    holderTypes: "any",
  },
  brother: {
    label: "Brother",
    base: "sibling",
    gender: "male",
    holderTypes: "any",
  },
  sister: {
    label: "Sister",
    base: "sibling",
    gender: "female",
    holderTypes: "any",
  },
  husband: {
    label: "Husband",
    base: "spouse",
    gender: "male",
    holderTypes: "any",
  },
  wife: { label: "Wife", base: "spouse", gender: "female", holderTypes: "any" },
  grandfather: {
    label: "Grandfather",
    base: "grandparent",
    gender: "male",
    holderTypes: "any",
  },
  grandmother: {
    label: "Grandmother",
    base: "grandparent",
    gender: "female",
    holderTypes: "any",
  },
  grandson: {
    label: "Grandson",
    base: "grandchild",
    gender: "male",
    holderTypes: "any",
  },
  granddaughter: {
    label: "Granddaughter",
    base: "grandchild",
    gender: "female",
    holderTypes: "any",
  },
  uncle: {
    label: "Uncle",
    base: "pibling",
    gender: "male",
    holderTypes: "any",
  },
  aunt: {
    label: "Aunt",
    base: "pibling",
    gender: "female",
    holderTypes: "any",
  },
  nephew: {
    label: "Nephew",
    base: "nibling",
    gender: "male",
    holderTypes: "any",
  },
  niece: {
    label: "Niece",
    base: "nibling",
    gender: "female",
    holderTypes: "any",
  },
  "father-in-law": {
    label: "Father-in-law",
    base: "parent-in-law",
    gender: "male",
    holderTypes: "any",
  },
  "mother-in-law": {
    label: "Mother-in-law",
    base: "parent-in-law",
    gender: "female",
    holderTypes: "any",
  },
  "son-in-law": {
    label: "Son-in-law",
    base: "child-in-law",
    gender: "male",
    holderTypes: "any",
  },
  "daughter-in-law": {
    label: "Daughter-in-law",
    base: "child-in-law",
    gender: "female",
    holderTypes: "any",
  },
  "brother-in-law": {
    label: "Brother-in-law",
    base: "sibling-in-law",
    gender: "male",
    holderTypes: "any",
  },
  "sister-in-law": {
    label: "Sister-in-law",
    base: "sibling-in-law",
    gender: "female",
    holderTypes: "any",
  },
};

/**
 * The one-hop composition table, keyed by *neutral* base roles. `composeRoles`
 * reads it as `table[M rel. S][O rel. M] = O rel. S`: given the role the
 * intermediate M holds relative to the subject S, and the role the far node O
 * holds relative to M, it yields O's derived neutral role relative to S.
 *
 * Deliberately small in v1 — only the rows below derive; everything else is
 * `undefined`. Excluded for now (future, by design): `(parent,child)→sibling`,
 * `(parent,spouse)→parent`, `(sibling,parent)→parent`, cousins, in-laws of
 * in-laws.
 */
const compositionTable: Partial<
  Record<RelationshipRole, Partial<Record<RelationshipRole, RelationshipRole>>>
> = {
  parent: { parent: "grandparent", sibling: "pibling" },
  sibling: { child: "nibling" },
  child: { child: "grandchild" },
  spouse: { parent: "parent-in-law", sibling: "sibling-in-law" },
};

/** The {@link RoleDef} for a role, or undefined if it isn't a known role. */
export function getRoleDef(role: string): RoleDef | undefined {
  return Object.hasOwn(roleDefs, role)
    ? roleDefs[role as RelationshipRole]
    : undefined;
}

/** The neutral base role a (possibly gendered) role specialises. */
export function baseRole(role: RelationshipRole): RelationshipRole {
  return roleDefs[role].base;
}

/** The gender a role implies for its holder, or undefined for neutral roles. */
export function impliedGender(role: RelationshipRole): Gender | undefined {
  return roleDefs[role].gender;
}

/**
 * The gendered form of a neutral base for a holder of `gender`, or the base
 * unchanged when there is no variant — `nonbinary` (no gendered form), or bases
 * with no variants at all (`friend`, `owner`, …). Accepts a `null` gender for
 * convenience (treated as "no variant").
 */
export function genderedVariant(
  base: RelationshipRole,
  gender: Gender | null | undefined,
): RelationshipRole {
  if (gender === "male" || gender === "female") {
    return genderedVariants[base]?.[gender] ?? base;
  }
  return base;
}

/**
 * The gender-neutral inverse of a role (its own inverse when symmetric). For a
 * gendered variant the inverse is resolved through its base, so it is always
 * neutral: `inverseRole("father")` is `"child"`, not "son".
 */
export function inverseRole(role: RelationshipRole): RelationshipRole {
  const def = roleDefs[role];
  // Neutral roles carry their inverse directly; gendered variants defer to base.
  return def.inverse ?? roleDefs[def.base].inverse ?? def.base;
}

/**
 * Display label for a role as held by someone of `holderGender`. An explicit
 * gendered role always shows its own label. A neutral role shows the gendered
 * label when the holder's gender selects a variant (e.g. `child` + male ⇒
 * "Son"), and the plain neutral label otherwise (no gender, or `nonbinary`).
 */
export function labelForRole(
  role: RelationshipRole,
  holderGender?: Gender | null,
): string {
  const def = roleDefs[role];
  // Already a gendered variant (or a neutral with no variants): show as-is.
  if (def.base !== role) return def.label;
  const variant = genderedVariant(role, holderGender);
  return roleDefs[variant].label;
}

/**
 * Compose one hop: given the role the intermediate M holds relative to the
 * subject S (`mRelSubject`) and the role the far node O holds relative to M
 * (`oRelM`), return O's derived **neutral** role relative to S, or undefined
 * when the pair doesn't compose. Operates on the neutral base of each input, so
 * gendered variants compose just like their bases.
 */
export function composeRoles(
  mRelSubject: RelationshipRole,
  oRelM: RelationshipRole,
): RelationshipRole | undefined {
  return compositionTable[baseRole(mRelSubject)]?.[baseRole(oRelM)];
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
 * Roles the *other* end may hold given the *subject*'s type, restricted so the
 * auto-derived inverse (the subject's own role) is also valid for the subject.
 * Drives the single-role pickers where the subject's role is implied rather than
 * entered: on a Pet, a person candidate may be "Owner" (inverse "pet" is a valid
 * pet role) but not "Pet"; on a Person, another person can't be an "Owner" since
 * the implied "pet" role can't be held by a person.
 */
export function rolesForPair(
  otherType: EntityType,
  subjectType: EntityType,
): { role: RelationshipRole; label: string }[] {
  return rolesForHolder(otherType).filter((r) =>
    holderAllows(inverseRole(r.role), subjectType),
  );
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
 * display, with that end's role. The kinship service builds these so the
 * renderer never deals with the stored a/b orientation.
 *
 * `origin` distinguishes a stored ("explicit") edge from one computed live by
 * the inference engine ("derived"). Derived edges have no stored row, so
 * `relationshipId` is empty for them; `derivedVia` names the intermediate entity
 * the edge was inferred through (e.g. George-as-uncle "via John").
 */
export interface RelationshipNeighbor {
  relationshipId: string;
  otherType: EntityType;
  otherId: string;
  otherLabel: string;
  otherRole: RelationshipRole;
  otherRoleLabel: string;
  otherRoleNote: string | null;
  origin: "explicit" | "derived";
  derivedVia?: { type: EntityType; id: string; label: string };
}

/**
 * Among an entity's oriented neighbors, the **explicit** edges whose role bases
 * to `spouse` — the seed for inferring a wedding's other party from a Person.
 * Derived edges are excluded: only a stored marriage edge can hold a wedding
 * milestone, so inference must bind to one that exists. When exactly one is
 * returned the add-from-Person flow can auto-bind without prompting.
 */
export function spouseNeighbors(
  neighbors: RelationshipNeighbor[],
): RelationshipNeighbor[] {
  return neighbors.filter(
    (n) => n.origin === "explicit" && baseRole(n.otherRole) === "spouse",
  );
}
