import type { RelationshipNeighbor } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  entityBasePath,
  neighborKey,
  neighborPath,
  relationshipEditPath,
  relationshipRemovePath,
} from "../src/headless/index.js";

/** A stored edge — addressable by its own id. */
const explicit = {
  origin: "explicit",
  relationshipId: "rel-1",
  otherType: "person",
  otherId: "p-2",
  otherRole: "mother",
  otherRoleLabel: "Mother",
  otherLabel: "Ada Lovelace",
} as RelationshipNeighbor;

/** An inferred edge — no stored id, so it travels by identity. */
const derived = {
  ...explicit,
  origin: "derived",
  relationshipId: undefined,
} as unknown as RelationshipNeighbor;

describe("entityBasePath", () => {
  it("routes each bearer type to its own list", () => {
    expect(entityBasePath("person")).toBe("/people");
    expect(entityBasePath("pet")).toBe("/pets");
    expect(entityBasePath("relationship")).toBe("/relationships");
  });
});

describe("neighborPath", () => {
  it("points at the neighbor's own page, not the relationship's", () => {
    expect(neighborPath(explicit)).toBe("/people/p-2");
  });
});

describe("neighborKey", () => {
  it("uses the stored id for an explicit edge", () => {
    expect(neighborKey(explicit)).toBe("rel-1");
  });

  it("derives a key from the edge identity when there is no id", () => {
    expect(neighborKey(derived)).toContain("p-2");
    // Different base roles to the same person are different edges.
    const sibling = { ...derived, otherRole: "sister" } as RelationshipNeighbor;
    expect(neighborKey(derived)).not.toBe(neighborKey(sibling));
  });

  it("keys gendered variants of one role to the same edge", () => {
    // “Mother” and “father” are both `parent`, and a derived edge is identified
    // by its base role — so these are the same edge seen from two genders, not
    // two edges that happen to collide.
    const father = { ...derived, otherRole: "father" } as RelationshipNeighbor;
    expect(neighborKey(derived)).toBe(neighborKey(father));
  });
});

describe("relationship row paths", () => {
  it("addresses a stored edge by id", () => {
    expect(relationshipEditPath("/people/p-1", explicit)).toBe(
      "/people/p-1/relationships/rel-1/edit",
    );
    expect(relationshipRemovePath("/people/p-1", explicit)).toBe(
      "/people/p-1/relationships/rel-1/delete",
    );
  });

  it("addresses a derived edge by identity in the query string", () => {
    const edit = relationshipEditPath("/people/p-1", derived);
    expect(edit.startsWith("/people/p-1/relationships/edit?")).toBe(true);
    const params = new URLSearchParams(edit.split("?")[1]);
    expect(params.get("otherType")).toBe("person");
    expect(params.get("otherId")).toBe("p-2");
    // The *base* role, not the gendered variant the row displayed: that is what
    // identifies the inferred edge on the other end.
    expect(params.get("role")).toBe("parent");
  });

  it("removes a derived edge by dismissing it, since there is no row to delete", () => {
    expect(relationshipRemovePath("/people/p-1", derived)).toContain(
      "/relationships/dismiss?",
    );
  });

  it("works from a pet's page as well as a person's", () => {
    expect(relationshipEditPath("/pets/x-1", explicit)).toBe(
      "/pets/x-1/relationships/rel-1/edit",
    );
  });
});
