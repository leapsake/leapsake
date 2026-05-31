import { describe, expect, it } from "vitest";
import {
  createPersonInputSchema,
  personSchema,
  updatePersonInputSchema,
} from "./person.js";

const validPerson = {
  id: crypto.randomUUID(),
  firstName: "Ada",
  lastName: "Lovelace",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

describe("personSchema", () => {
  it("accepts a valid person", () => {
    expect(personSchema.parse(validPerson)).toEqual(validPerson);
  });

  it("accepts a non-null deletedAt", () => {
    const deleted = { ...validPerson, deletedAt: Date.now() };
    expect(personSchema.parse(deleted)).toEqual(deleted);
  });

  it("rejects an empty firstName", () => {
    expect(() =>
      personSchema.parse({ ...validPerson, firstName: "" }),
    ).toThrow();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      personSchema.parse({ ...validPerson, id: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects a non-integer timestamp", () => {
    expect(() =>
      personSchema.parse({ ...validPerson, createdAt: 1.5 }),
    ).toThrow();
  });
});

describe("createPersonInputSchema", () => {
  it("accepts both names", () => {
    expect(
      createPersonInputSchema.parse({ firstName: "Ada", lastName: "Lovelace" }),
    ).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });

  it("rejects a missing lastName", () => {
    expect(() => createPersonInputSchema.parse({ firstName: "Ada" })).toThrow();
  });

  it("rejects an empty firstName", () => {
    expect(() =>
      createPersonInputSchema.parse({ firstName: "", lastName: "Lovelace" }),
    ).toThrow();
  });
});

describe("updatePersonInputSchema", () => {
  it("accepts a partial update", () => {
    expect(updatePersonInputSchema.parse({ firstName: "Grace" })).toEqual({
      firstName: "Grace",
    });
  });

  it("accepts an empty object", () => {
    expect(updatePersonInputSchema.parse({})).toEqual({});
  });

  it("rejects an empty firstName when present", () => {
    expect(() => updatePersonInputSchema.parse({ firstName: "" })).toThrow();
  });
});
