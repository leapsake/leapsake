import {
  type EntityType,
  type PersonDraft,
  type PetDraft,
  type CreatePersonInput,
  type CreatePetInput,
  personDraftOf,
  personInputOf,
  petDraftOf,
  petInputOf,
} from "@leapsake/schema";

const TEXT = {
  personName: "Enter a first, middle or last name before saving.",
  petName: "Enter the pet’s name before saving.",
} as const;

/** A new person's or pet's own details, as typed. */
export interface EntityFormValue {
  person: PersonDraft;
  pet: PetDraft;
}

export function emptyEntityForm(): EntityFormValue {
  return { person: personDraftOf(), pet: petDraftOf() };
}

/** A fresh form for the other type, carrying the name and gender. */
export function switchedEntityForm(
  from: EntityType,
  value: EntityFormValue,
): EntityFormValue {
  const next = emptyEntityForm();
  if (from === "person") {
    const { firstName, middleName, lastName, gender } = value.person;
    const name = [firstName, middleName, lastName]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" ");
    next.pet = { ...next.pet, name, gender };
  } else {
    const { name, gender } = value.pet;
    next.person = { ...next.person, firstName: name, gender };
  }
  return next;
}

/** The details as a record takes them, or null while the name is missing. */
export function entityDetailsOf(
  type: EntityType,
  value: EntityFormValue,
): CreatePersonInput | CreatePetInput | null {
  const shaped =
    type === "person" ? personInputOf(value.person) : petInputOf(value.pet);
  return shaped.ok ? shaped.input : null;
}

/** Why the form can't be saved yet, or undefined once it can. */
export function entityFormProblem(
  type: EntityType,
  value: EntityFormValue,
): string | undefined {
  if (entityDetailsOf(type, value) !== null) return undefined;
  return type === "person" ? TEXT.personName : TEXT.petName;
}
