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

  // A person needs *some* name, not a first one and a last one — "Jen" and
  // "Jen Davis" are both whole people. The rule that replaced the old pair of
  // requirements is "at least one part", and it lives on the row so that every
  // write path inherits it: create, update, import, and sync's decode.
  it("accepts a first name alone", () => {
    const mononym = { ...validPerson, lastName: null };
    expect(personSchema.parse(mononym)).toEqual(mononym);
  });

  it("accepts a last name alone", () => {
    const surnameOnly = { ...validPerson, firstName: null };
    expect(personSchema.parse(surnameOnly)).toEqual(surnameOnly);
  });

  it("accepts a middle name alone", () => {
    const middleOnly = {
      ...validPerson,
      firstName: null,
      middleName: "Byron",
      lastName: null,
    };
    expect(personSchema.parse(middleOnly)).toEqual(middleOnly);
  });

  it("rejects a person with no name at all", () => {
    expect(() =>
      personSchema.parse({
        ...validPerson,
        firstName: null,
        middleName: null,
        lastName: null,
      }),
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

  it("accepts a first name alone", () => {
    expect(createPersonInputSchema.parse({ firstName: "Cher" })).toEqual({
      firstName: "Cher",
    });
  });

  it("accepts a last name alone", () => {
    expect(createPersonInputSchema.parse({ lastName: "Davis" })).toEqual({
      lastName: "Davis",
    });
  });

  it("rejects an input with no name at all", () => {
    expect(() => createPersonInputSchema.parse({ gender: "female" })).toThrow();
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

  // Deliberately unrefined, unlike the create input: a patch that touches only
  // the gender carries no name and must still be legal. The "at least one name"
  // rule is enforced against the *merged* row by `entity-repo`'s update, which
  // is the only place that can see what the patch would leave behind.
  it("accepts a patch carrying no name", () => {
    expect(updatePersonInputSchema.parse({ gender: "female" })).toEqual({
      gender: "female",
    });
  });

  it("accepts a patch clearing one name part", () => {
    expect(updatePersonInputSchema.parse({ lastName: null })).toEqual({
      lastName: null,
    });
  });
});
