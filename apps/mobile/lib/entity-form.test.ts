import { describe, expect, it } from "vitest";
import {
  emptyEntityForm,
  entityDetailsOf,
  entityDraftDetailsOf,
  entityFormProblem,
  switchedEntityForm,
} from "./entity-form";

describe("entityFormProblem", () => {
  it("asks a person for some part of a name, and a pet for its name", () => {
    expect(entityFormProblem("person", emptyEntityForm())).toBe(
      "Enter a first, middle or last name before saving.",
    );
    expect(entityFormProblem("pet", emptyEntityForm())).toBe(
      "Enter the pet’s name before saving.",
    );
  });

  it("has nothing to say once the name is there", () => {
    const value = emptyEntityForm();
    value.person.lastName = "Bailey";
    expect(entityFormProblem("person", value)).toBeUndefined();
  });
});

describe("entityDetailsOf", () => {
  it("gives the details a record takes, once there is a name", () => {
    const value = emptyEntityForm();
    expect(entityDetailsOf("person", value)).toBeNull();
    value.person.firstName = " George ";
    value.person.gender = "male";
    expect(entityDetailsOf("person", value)).toEqual({
      firstName: "George",
      middleName: null,
      lastName: null,
      gender: "male",
      nationalities: [],
      religions: [],
    });
  });
});

describe("entityDraftDetailsOf", () => {
  it("keeps the details as typed, with or without a name", () => {
    const value = emptyEntityForm();
    expect(entityDraftDetailsOf("person", value)).toEqual({
      firstName: null,
      middleName: null,
      lastName: null,
      gender: null,
    });
    expect(entityDraftDetailsOf("pet", value)).toEqual({
      name: "",
      gender: null,
    });
    value.pet.name = " Jimmy ";
    expect(entityDraftDetailsOf("pet", value)).toEqual({
      name: "Jimmy",
      gender: null,
    });
  });
});

describe("switchedEntityForm", () => {
  it("brings a person's name and gender to the pet", () => {
    const value = emptyEntityForm();
    value.person = {
      firstName: "Mary",
      middleName: " ",
      lastName: "Hatch",
      gender: "female",
      nationalities: [],
      religions: [],
      tags: "",
    };
    expect(switchedEntityForm("person", value).pet).toEqual({
      name: "Mary Hatch",
      gender: "female",
      tags: "",
    });
  });

  it("brings a pet's name to the person's first name", () => {
    const value = emptyEntityForm();
    value.pet = { name: "Jimmy", gender: null, tags: "" };
    expect(switchedEntityForm("pet", value).person.firstName).toBe("Jimmy");
  });
});
