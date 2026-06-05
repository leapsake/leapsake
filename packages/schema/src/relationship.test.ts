import { describe, expect, it } from "vitest";
import {
  baseRole,
  composeRoles,
  createRelationshipInputSchema,
  genderedVariant,
  holderAllows,
  impliedGender,
  inverseRole,
  labelForRole,
  relationshipSchema,
  rolesForHolder,
  rolesForPair,
} from "./relationship.js";

const validRelationship = {
  id: crypto.randomUUID(),
  aType: "person" as const,
  aId: crypto.randomUUID(),
  aRole: "parent" as const,
  aRoleNote: null,
  bType: "person" as const,
  bId: crypto.randomUUID(),
  bRole: "child" as const,
  bRoleNote: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

describe("relationshipSchema", () => {
  it("accepts a valid relationship", () => {
    expect(relationshipSchema.parse(validRelationship)).toEqual(
      validRelationship,
    );
  });

  it("accepts a note only when the role is 'other'", () => {
    const withOther = {
      ...validRelationship,
      aRole: "other" as const,
      aRoleNote: "godparent",
    };
    expect(relationshipSchema.parse(withOther).aRoleNote).toBe("godparent");
  });

  it("rejects a note when the role is not 'other'", () => {
    expect(() =>
      relationshipSchema.parse({ ...validRelationship, aRoleNote: "nope" }),
    ).toThrow();
  });

  it("accepts a person↔pet owner/pet relationship", () => {
    const owned = {
      ...validRelationship,
      aType: "person" as const,
      aRole: "owner" as const,
      bType: "pet" as const,
      bRole: "pet" as const,
    };
    expect(relationshipSchema.parse(owned)).toEqual(owned);
  });

  it("rejects a role whose holder type is not allowed", () => {
    // owner must be held by a person, not a pet
    expect(() =>
      relationshipSchema.parse({
        ...validRelationship,
        aType: "pet",
        aRole: "owner",
        bType: "pet",
        bRole: "pet",
      }),
    ).toThrow();
  });

  it("rejects an unknown role and a non-uuid id", () => {
    expect(() =>
      relationshipSchema.parse({ ...validRelationship, aRole: "frenemy" }),
    ).toThrow();
    expect(() =>
      relationshipSchema.parse({ ...validRelationship, id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("createRelationshipInputSchema", () => {
  it("accepts endpoints and roles without notes", () => {
    const input = {
      aType: "person" as const,
      aId: crypto.randomUUID(),
      aRole: "friend" as const,
      bType: "person" as const,
      bId: crypto.randomUUID(),
      bRole: "friend" as const,
    };
    expect(createRelationshipInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a note on a non-'other' role", () => {
    expect(() =>
      createRelationshipInputSchema.parse({
        aType: "person",
        aId: crypto.randomUUID(),
        aRole: "friend",
        aRoleNote: "nope",
        bType: "person",
        bId: crypto.randomUUID(),
        bRole: "friend",
      }),
    ).toThrow();
  });
});

describe("role registry", () => {
  it("maps asymmetric roles to their inverse", () => {
    expect(inverseRole("parent")).toBe("child");
    expect(inverseRole("child")).toBe("parent");
    expect(inverseRole("owner")).toBe("pet");
    expect(inverseRole("grandparent")).toBe("grandchild");
  });

  it("treats symmetric roles as their own inverse", () => {
    expect(inverseRole("friend")).toBe("friend");
    expect(inverseRole("sibling")).toBe("sibling");
    expect(inverseRole("other")).toBe("other");
  });

  it("constrains owner/pet to their holder types", () => {
    expect(holderAllows("owner", "person")).toBe(true);
    expect(holderAllows("owner", "pet")).toBe(false);
    expect(holderAllows("pet", "pet")).toBe(true);
    expect(holderAllows("pet", "person")).toBe(false);
    expect(holderAllows("friend", "pet")).toBe(true);
  });

  it("lists the holdable roles per entity type", () => {
    const personRoles = rolesForHolder("person").map((r) => r.role);
    expect(personRoles).toContain("owner");
    expect(personRoles).not.toContain("pet");

    const petRoles = rolesForHolder("pet").map((r) => r.role);
    expect(petRoles).toContain("pet");
    expect(petRoles).not.toContain("owner");
  });

  it("restricts pair roles so the implied inverse is valid for the subject", () => {
    // On a pet, a person candidate can be the Owner (inverse "pet" fits a pet)…
    const personRolesForPet = rolesForPair("person", "pet").map((r) => r.role);
    expect(personRolesForPet).toContain("owner");

    // …but on a person, another person can't be an Owner (inverse "pet" can't
    // be held by a person), while ordinary social roles still apply.
    const personRolesForPerson = rolesForPair("person", "person").map(
      (r) => r.role,
    );
    expect(personRolesForPerson).not.toContain("owner");
    expect(personRolesForPerson).toContain("friend");
    // Gendered + kinship variants surface automatically now they're registered.
    expect(personRolesForPerson).toContain("father");
    expect(personRolesForPerson).toContain("uncle");
  });
});

describe("gendered role system", () => {
  it("resolves the neutral base of any role", () => {
    expect(baseRole("father")).toBe("parent");
    expect(baseRole("daughter")).toBe("child");
    expect(baseRole("uncle")).toBe("pibling");
    expect(baseRole("niece")).toBe("nibling");
    expect(baseRole("brother-in-law")).toBe("sibling-in-law");
    // A neutral role is its own base.
    expect(baseRole("parent")).toBe("parent");
    expect(baseRole("friend")).toBe("friend");
  });

  it("reports the gender a gendered role implies, and none for neutral roles", () => {
    expect(impliedGender("father")).toBe("male");
    expect(impliedGender("mother")).toBe("female");
    expect(impliedGender("aunt")).toBe("female");
    expect(impliedGender("parent")).toBeUndefined();
    expect(impliedGender("friend")).toBeUndefined();
  });

  it("maps a base + gender to its gendered variant", () => {
    expect(genderedVariant("parent", "male")).toBe("father");
    expect(genderedVariant("parent", "female")).toBe("mother");
    expect(genderedVariant("child", "male")).toBe("son");
    expect(genderedVariant("pibling", "female")).toBe("aunt");
    expect(genderedVariant("sibling-in-law", "male")).toBe("brother-in-law");
  });

  it("returns the base unchanged when there is no variant", () => {
    expect(genderedVariant("parent", "nonbinary")).toBe("parent");
    expect(genderedVariant("parent", null)).toBe("parent");
    expect(genderedVariant("parent", undefined)).toBe("parent");
    // Bases with no gendered forms at all.
    expect(genderedVariant("friend", "male")).toBe("friend");
    expect(genderedVariant("owner", "female")).toBe("owner");
  });

  it("inverts gendered roles to the neutral inverse of their base", () => {
    expect(inverseRole("father")).toBe("child");
    expect(inverseRole("daughter")).toBe("parent");
    expect(inverseRole("uncle")).toBe("nibling");
    expect(inverseRole("niece")).toBe("pibling");
    expect(inverseRole("brother")).toBe("sibling");
    expect(inverseRole("husband")).toBe("spouse");
  });

  describe("labelForRole", () => {
    it("genders a neutral role by the holder's gender", () => {
      expect(labelForRole("child", "male")).toBe("Son");
      expect(labelForRole("child", "female")).toBe("Daughter");
      expect(labelForRole("parent", "female")).toBe("Mother");
      expect(labelForRole("pibling", "male")).toBe("Uncle");
    });

    it("passes an explicit gendered role through as its own label", () => {
      expect(labelForRole("father")).toBe("Father");
      // Even given a contradictory holder gender, the explicit role wins.
      expect(labelForRole("father", "female")).toBe("Father");
    });

    it("keeps the neutral label for non-binary or unknown holders", () => {
      expect(labelForRole("child")).toBe("Child");
      expect(labelForRole("child", null)).toBe("Child");
      expect(labelForRole("child", "nonbinary")).toBe("Child");
      expect(labelForRole("pibling", "nonbinary")).toBe("Uncle/Aunt");
    });
  });

  describe("composeRoles", () => {
    it("derives the documented one-hop neutral roles", () => {
      expect(composeRoles("parent", "parent")).toBe("grandparent");
      expect(composeRoles("parent", "sibling")).toBe("pibling");
      expect(composeRoles("sibling", "child")).toBe("nibling");
      expect(composeRoles("child", "child")).toBe("grandchild");
      expect(composeRoles("spouse", "parent")).toBe("parent-in-law");
      expect(composeRoles("spouse", "sibling")).toBe("sibling-in-law");
    });

    it("composes on the neutral base, so gendered inputs compose too", () => {
      // Josh's father (parent) ; that father's brother (sibling) ⇒ pibling.
      expect(composeRoles("father", "brother")).toBe("pibling");
      expect(composeRoles("mother", "sister")).toBe("pibling");
    });

    it("returns undefined for pairs that do not compose in v1", () => {
      expect(composeRoles("parent", "child")).toBeUndefined();
      expect(composeRoles("sibling", "parent")).toBeUndefined();
      expect(composeRoles("friend", "friend")).toBeUndefined();
      expect(composeRoles("spouse", "spouse")).toBeUndefined();
    });
  });
});
