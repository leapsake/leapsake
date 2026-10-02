import { contactMethodDraftOf } from "@leapsake/contact-links";
import { describe, expect, it, vi } from "vitest";
import {
  emptyEntityForm,
  entityFormProblem,
  hasStagedRows,
  switchedEntityForm,
} from "./entity-form";

// The form's row helpers live beside their components; these stand in for what those import.
vi.mock("react-native", () => ({ StyleSheet: { create: (s: unknown) => s } }));
vi.mock("@react-native-picker/picker", () => ({ Picker: {} }));
vi.mock("expo-router", () => ({}));
vi.mock("./core-context", () => ({ useCore: () => null }));

describe("entityFormProblem", () => {
  it("asks a person for some part of a name, and a pet for its name", () => {
    expect(entityFormProblem("person", emptyEntityForm())).toBe(
      "Enter a first, middle or last name before saving.",
    );
    expect(entityFormProblem("pet", emptyEntityForm())).toBe(
      "Enter the pet’s name before saving.",
    );
  });

  it("has nothing to say once the name is there and no row is half-filled", () => {
    const value = emptyEntityForm();
    value.person.lastName = "Bailey";
    value.contacts = [{ key: "c-1", draft: contactMethodDraftOf("phone") }];
    expect(entityFormProblem("person", value)).toBeUndefined();
  });

  it("names a staged row that is half-filled", () => {
    const value = emptyEntityForm();
    value.person.lastName = "Bailey";
    value.contacts = [
      {
        key: "c-1",
        draft: { ...contactMethodDraftOf("phone"), label: "", number: "555" },
      },
    ];
    expect(entityFormProblem("person", value)).toBe(
      "Finish or remove the unfinished contact method before saving.",
    );
  });
});

describe("switchedEntityForm", () => {
  it("brings a person's name, gender and tags to the pet", () => {
    const value = emptyEntityForm();
    value.person = {
      firstName: "Mary",
      middleName: " ",
      lastName: "Hatch",
      gender: "female",
      tags: "family",
    };
    expect(switchedEntityForm("person", value).pet).toEqual({
      name: "Mary Hatch",
      gender: "female",
      tags: "family",
    });
  });

  it("brings a pet's name to the person's first name", () => {
    const value = emptyEntityForm();
    value.pet = { name: "Buffalo", gender: null, tags: "" };
    expect(switchedEntityForm("pet", value).person.firstName).toBe("Buffalo");
  });

  it("drops every staged row", () => {
    const value = emptyEntityForm();
    value.contacts = [{ key: "c-1", draft: contactMethodDraftOf("phone") }];
    expect(hasStagedRows(value)).toBe(true);
    expect(hasStagedRows(switchedEntityForm("person", value))).toBe(false);
  });
});
