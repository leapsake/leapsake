import { describe, expect, it } from "vitest";
import {
  contentKeySchema,
  createContentKeyInputSchema,
} from "./content-key.js";

const validRow = {
  id: crypto.randomUUID(),
  entityType: "person",
  entityId: crypto.randomUUID(),
  blobRef: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

describe("contentKeySchema", () => {
  it("parses a valid row", () => {
    expect(contentKeySchema.parse(validRow)).toEqual(validRow);
  });

  it("accepts an open-ended entityType", () => {
    expect(
      contentKeySchema.parse({ ...validRow, entityType: "photo_album" })
        .entityType,
    ).toBe("photo_album");
  });

  it("rejects an empty entityType", () => {
    expect(() =>
      contentKeySchema.parse({ ...validRow, entityType: "" }),
    ).toThrow();
  });

  it("rejects a non-uuid entityId", () => {
    expect(() =>
      contentKeySchema.parse({ ...validRow, entityId: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("createContentKeyInputSchema", () => {
  it("accepts the minimal entity reference", () => {
    const input = { entityType: "pet", entityId: crypto.randomUUID() };
    expect(createContentKeyInputSchema.parse(input)).toEqual(input);
  });
});
