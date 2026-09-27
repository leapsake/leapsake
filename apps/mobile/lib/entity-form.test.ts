import { contactMethodDraftOf } from "@leapsake/contact-links";
import { describe, expect, it, vi } from "vitest";
import { emptyEntityForm, entityFormProblem } from "./entity-form";

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
