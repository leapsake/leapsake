import { describe, expect, it } from "vitest";
import {
  SELF_PERSON_ID_NAME,
  SELF_PERSON_NAMESPACE,
  selfPersonSchema,
  setSelfInputSchema,
} from "./self-person.js";

const validSelf = {
  id: crypto.randomUUID(),
  personId: crypto.randomUUID(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

describe("self-person constants", () => {
  it("keeps a stable namespace and id name (changing either re-mints the row)", () => {
    // Pinned — the derived SELF_PERSON_ID must never move, or every device would
    // re-mint "you" under a new primary key and duplicate the row on next sync.
    expect(SELF_PERSON_NAMESPACE).toBe("leapsake:self-person");
    expect(SELF_PERSON_ID_NAME).toBe("singleton");
  });
});

describe("selfPersonSchema", () => {
  it("accepts a valid self-person row", () => {
    expect(selfPersonSchema.parse(validSelf)).toEqual(validSelf);
  });

  it("accepts a non-null deletedAt (a cleared self)", () => {
    const cleared = { ...validSelf, deletedAt: Date.now() };
    expect(selfPersonSchema.parse(cleared)).toEqual(cleared);
  });

  it("rejects a non-uuid personId", () => {
    expect(() =>
      selfPersonSchema.parse({ ...validSelf, personId: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects a non-integer timestamp", () => {
    expect(() =>
      selfPersonSchema.parse({ ...validSelf, updatedAt: 1.5 }),
    ).toThrow();
  });
});

describe("setSelfInputSchema", () => {
  it("accepts a person id", () => {
    const personId = crypto.randomUUID();
    expect(setSelfInputSchema.parse({ personId })).toEqual({ personId });
  });

  it("rejects a non-uuid person id", () => {
    expect(() => setSelfInputSchema.parse({ personId: "nope" })).toThrow();
  });
});
