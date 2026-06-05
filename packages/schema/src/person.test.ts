import { describe, expect, it } from "vitest";
import {
  createPersonInputSchema,
  personSchema,
  updatePersonInputSchema,
} from "./person.js";

const validPerson = {
  id: crypto.randomUUID(),
  firstName: "Ada",
  middleName: null,
  lastName: "Lovelace",
  gender: null,
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

  it("accepts a non-null middleName", () => {
    const withMiddle = { ...validPerson, middleName: "Byron" };
    expect(personSchema.parse(withMiddle)).toEqual(withMiddle);
  });

  it("rejects an empty middleName", () => {
    expect(() =>
      personSchema.parse({ ...validPerson, middleName: "" }),
    ).toThrow();
  });

  it("accepts an explicit gender", () => {
    const gendered = { ...validPerson, gender: "female" as const };
    expect(personSchema.parse(gendered)).toEqual(gendered);
  });

  it("rejects an unknown gender", () => {
    expect(() =>
      personSchema.parse({ ...validPerson, gender: "unknown" }),
    ).toThrow();
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

  it("accepts an optional middleName", () => {
    expect(
      createPersonInputSchema.parse({
        firstName: "Ada",
        middleName: "Byron",
        lastName: "Lovelace",
      }),
    ).toEqual({ firstName: "Ada", middleName: "Byron", lastName: "Lovelace" });
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
