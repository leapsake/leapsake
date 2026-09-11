import { describe, expect, it } from "vitest";
import {
  createPersonInputSchema,
  personSchema,
  updatePersonInputSchema,
} from "./person.js";

const validPerson = {
  id: crypto.randomUUID(),
  firstName: "Mary",
  middleName: null,
  lastName: "Bailey",
  gender: null,
  standing: "published" as const,
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
    const withMiddle = { ...validPerson, middleName: "Hatch" };
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

  // A person needs *some* name, not a first one and a last one — "Ruth" and
  // "Ruth Dakin" are both whole people. The rule that replaced the old pair of
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
      middleName: "Hatch",
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

  // The column carries a default so that a record pulled from a peer that
  // predates it decodes as one of the user's own people rather than failing
  // validation — sync's `decode` runs this very schema over the payload.
  it("defaults an absent standing to published", () => {
    const { standing: _omitted, ...withoutStanding } = validPerson;
    expect(personSchema.parse(withoutStanding).standing).toBe("published");
  });

  it("accepts an unpublished standing", () => {
    const unpublished = { ...validPerson, standing: "unpublished" as const };
    expect(personSchema.parse(unpublished)).toEqual(unpublished);
  });

  it("rejects an unknown standing", () => {
    expect(() =>
      personSchema.parse({ ...validPerson, standing: "sort-of" }),
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
      createPersonInputSchema.parse({ firstName: "Mary", lastName: "Bailey" }),
    ).toEqual({ firstName: "Mary", lastName: "Bailey" });
  });

  it("accepts an optional middleName", () => {
    expect(
      createPersonInputSchema.parse({
        firstName: "Mary",
        middleName: "Hatch",
        lastName: "Bailey",
      }),
    ).toEqual({ firstName: "Mary", middleName: "Hatch", lastName: "Bailey" });
  });

  it("accepts a first name alone", () => {
    expect(createPersonInputSchema.parse({ firstName: "Zuzu" })).toEqual({
      firstName: "Zuzu",
    });
  });

  it("accepts a last name alone", () => {
    expect(createPersonInputSchema.parse({ lastName: "Dakin" })).toEqual({
      lastName: "Dakin",
    });
  });

  it("rejects an input with no name at all", () => {
    expect(() => createPersonInputSchema.parse({ gender: "female" })).toThrow();
  });

  it("rejects an empty firstName", () => {
    expect(() =>
      createPersonInputSchema.parse({ firstName: "", lastName: "Bailey" }),
    ).toThrow();
  });
});

describe("updatePersonInputSchema", () => {
  it("accepts a partial update", () => {
    expect(updatePersonInputSchema.parse({ firstName: "Henry" })).toEqual({
      firstName: "Henry",
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

  // A patch must say nothing about standing unless it was asked to. The row
  // schema's `standing` is defaulted, and a defaulted schema fills itself in even
  // under `.optional()` — so an input built from *that* one would stamp
  // `standing: "published"` onto every edit and quietly republish an unpublished
  // person who had their name corrected. Hence two schemas; this is the test that
  // notices if they're ever collapsed back into one.
  it("leaves standing alone unless the patch sets it", () => {
    expect(updatePersonInputSchema.parse({ firstName: "Ruth" })).toEqual({
      firstName: "Ruth",
    });
    expect(updatePersonInputSchema.parse({ standing: "published" })).toEqual({
      standing: "published",
    });
  });
});
