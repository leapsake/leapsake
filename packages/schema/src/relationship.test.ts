import { describe, expect, it } from "vitest";
import {
  createRelationshipInputSchema,
  holderAllows,
  inverseRole,
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
  });
});
