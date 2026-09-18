import { z } from "zod";
import type { Gender } from "./gender.js";
import type { Standing } from "./standing.js";

/** The kinds of entity a relationship can connect. */
export const entityTypeSchema = z.enum(["person", "pet"]);

export type EntityType = z.infer<typeof entityTypeSchema>;

/**
 * Relationship roles in UI listing order: neutral bases, then gendered variants
 * that imply their holder's gender. A subject's own end is always neutral.
 */
export const relationshipRoleSchema = z.enum([
  // Neutral base roles.
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

/** How a role displays, its neutral base and gender, and who may hold it. */
export interface RoleDef {
  /** Display label, e.g. "Parent" or "Father". */
  label: string;
  /** The neutral role this is a form of; a neutral role's base is itself. */
  base: RelationshipRole;
  /** The gender a gendered variant implies for its holder. */
  gender?: Gender;
  /**
   * The neutral role on the other end, set only on neutral roles; a gendered
   * variant resolves it through its base ({@link inverseRole}).
   */
  inverse?: RelationshipRole;
  /** The entity types that may hold this role. */
  holderTypes: EntityType[] | "any";
}

/** Each neutral base's male and female forms. */
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

/** Every role's definition, in UI listing order. */
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
 * `table[M rel. S][O rel. M]` is O's neutral role relative to S, where M is an
 * intermediate. Pairs not listed do not compose.
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
 * A neutral base's form for a holder of `gender`, or the base itself when there
 * is none (a `nonbinary` or null gender, or a base like `friend`).
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

/** A role's neutral inverse: `inverseRole("father")` is `"child"`. */
export function inverseRole(role: RelationshipRole): RelationshipRole {
  const def = roleDefs[role];
  return def.inverse ?? roleDefs[def.base].inverse ?? def.base;
}

/**
 * A role's label for a holder of `holderGender`: a neutral role takes their
 * gendered form ("Son" for a male `child`); a gendered role keeps its own.
 */
export function labelForRole(
  role: RelationshipRole,
  holderGender?: Gender | null,
): string {
  const def = roleDefs[role];
  if (def.base !== role) return def.label;
  const variant = genderedVariant(role, holderGender);
  return roleDefs[variant].label;
}

/**
 * O's neutral role relative to subject S, through intermediate M, or undefined
 * when the pair does not compose. Gendered roles compose as their bases.
 */
export function composeRoles(
  mRelSubject: RelationshipRole,
  oRelM: RelationshipRole,
): RelationshipRole | undefined {
  return compositionTable[baseRole(mRelSubject)]?.[baseRole(oRelM)];
}

/** Whether `type` may hold `role` (owner=person, pet=pet, else any). */
export function holderAllows(
  role: RelationshipRole,
  type: EntityType,
): boolean {
  const def = roleDefs[role];
  return def.holderTypes === "any" || def.holderTypes.includes(type);
}

/** The roles an entity type may hold, in listing order. */
export function rolesForHolder(
  type: EntityType,
): { role: RelationshipRole; label: string }[] {
  return (Object.keys(roleDefs) as RelationshipRole[])
    .filter((role) => holderAllows(role, type))
    .map((role) => ({ role, label: roleDefs[role].label }));
}

/**
 * Roles the other end may hold whose derived inverse the subject may also hold:
 * a person can be a pet's "Owner", but not another person's.
 */
export function rolesForPair(
  otherType: EntityType,
  subjectType: EntityType,
): { role: RelationshipRole; label: string }[] {
  return (Object.keys(roleDefs) as RelationshipRole[])
    .filter(
      (role) =>
        holderAllows(role, otherType) && subjectAllows(role, subjectType),
    )
    .map((role) => ({ role, label: roleDefs[role].label }));
}

/**
 * Whether a subject of this type may stand at the near end of `role` — that is,
 * whether it can hold the inverse the write will derive for it.
 */
function subjectAllows(
  role: RelationshipRole,
  subjectType: EntityType,
): boolean {
  return holderAllows(inverseRole(role), subjectType);
}

/**
 * Every role the other end could hold for this subject, before the other end is
 * chosen. A chosen role then narrows the other end ({@link holderTypesFor}).
 */
export function rolesForSubject(
  subjectType: EntityType,
): { role: RelationshipRole; label: string }[] {
  return (Object.keys(roleDefs) as RelationshipRole[])
    .filter((role) => subjectAllows(role, subjectType))
    .map((role) => ({ role, label: roleDefs[role].label }));
}

/** The entity types that may hold `role`, with `"any"` spelled out. */
export function holderTypesFor(role: RelationshipRole): readonly EntityType[] {
  const { holderTypes } = roleDefs[role];
  return holderTypes === "any" ? entityTypeSchema.options : holderTypes;
}

/**
 * One row holding both ends and both roles. The same two entities may relate
 * in more than one way.
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
 * A partial update to roles and notes; the ends cannot change. The repo
 * re-validates the merged row, so the whole-row rules still hold.
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
 * A relationship seen from one entity, the other end resolved. A `derived` edge
 * has no stored row, so its `relationshipId` is empty.
 */
export interface RelationshipNeighbor {
  relationshipId: string;
  otherType: EntityType;
  otherId: string;
  otherLabel: string;
  /**
   * `unpublished` when this edge is the only reason the other end exists, so
   * removing the edge removes that entity too.
   */
  otherStanding: Standing;
  otherRole: RelationshipRole;
  otherRoleLabel: string;
  otherRoleNote: string | null;
  origin: "explicit" | "derived";
  derivedVia?: { type: EntityType; id: string; label: string };
}

/**
 * The explicit spouse edges among `neighbors`: the stored relationships a
 * wedding added from a person could bind to.
 */
export function spouseNeighbors(
  neighbors: RelationshipNeighbor[],
): RelationshipNeighbor[] {
  return neighbors.filter(
    (n) => n.origin === "explicit" && baseRole(n.otherRole) === "spouse",
  );
}

/** Whether a role is a romantic partnership, married or not, in any gender. */
export function isRomanticRole(role: RelationshipRole): boolean {
  const base = baseRole(role);
  return base === "spouse" || base === "partner";
}

/**
 * A relationship's name for its own reminders: "Harry & Tilly". Not for one the
 * user is in; that names the other person alone.
 */
export function relationshipPairLabel(a: string, b: string): string {
  return `${a} & ${b}`;
}
