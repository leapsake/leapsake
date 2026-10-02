import {
  type EntityType,
  type PersonDraft,
  type PetDraft,
  personDraftOf,
  personInputOf,
  petDraftOf,
  petInputOf,
} from "@leapsake/schema";
import {
  type StagedContact,
  contactRowValid,
} from "../components/StagedContactsSection";
import type { StagedHoliday } from "../components/StagedHolidaysSection";
import {
  type StagedGift,
  giftRowsValid,
} from "../components/StagedGiftsSection";
import {
  type StagedMilestone,
  milestoneRowValid,
} from "../components/StagedMilestonesSection";
import {
  type StagedRelationship,
  relationshipRowValid,
} from "../components/StagedRelationshipsSection";

const TEXT = {
  personName: "Enter a first, middle or last name before saving.",
  petName: "Enter the pet’s name before saving.",
  milestones: "Finish or remove the unfinished milestone before saving.",
  contacts: "Finish or remove the unfinished contact method before saving.",
  relationships: "Finish or remove the unfinished relationship before saving.",
  gifts: "Name each gift, or remove it, before saving.",
} as const;

/** A new person or pet with every row staged, none written yet. */
export interface EntityFormValue {
  person: PersonDraft;
  pet: PetDraft;
  milestones: StagedMilestone[];
  contacts: StagedContact[];
  relationships: StagedRelationship[];
  holidays: StagedHoliday[];
  gifts: StagedGift[];
}

export function emptyEntityForm(): EntityFormValue {
  return {
    person: personDraftOf(),
    pet: petDraftOf(),
    milestones: [],
    contacts: [],
    relationships: [],
    holidays: [],
    gifts: [],
  };
}

/** A fresh form for the other type with the name, gender and tags; staged
 *  rows go, as a milestone kind or role legal for one may not be for both. */
export function switchedEntityForm(
  from: EntityType,
  value: EntityFormValue,
): EntityFormValue {
  const next = emptyEntityForm();
  if (from === "person") {
    const { firstName, middleName, lastName, gender, tags } = value.person;
    const name = [firstName, middleName, lastName]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" ");
    next.pet = { name, gender, tags };
  } else {
    const { name, gender, tags } = value.pet;
    next.person = { ...next.person, firstName: name, gender, tags };
  }
  return next;
}

/** Whether switching type would throw away a staged row. */
export function hasStagedRows(value: EntityFormValue): boolean {
  return [
    value.milestones,
    value.contacts,
    value.relationships,
    value.holidays,
    value.gifts,
  ].some((rows) => rows.length > 0);
}

/**
 * Why the form can't be saved yet, or undefined once it can: the name first,
 * then any half-filled staged row. An untouched row is skipped.
 */
export function entityFormProblem(
  type: EntityType,
  value: EntityFormValue,
): string | undefined {
  if (type === "person" && !personInputOf(value.person).ok) {
    return TEXT.personName;
  }
  if (type === "pet" && !petInputOf(value.pet).ok) return TEXT.petName;
  if (!value.milestones.every(milestoneRowValid)) return TEXT.milestones;
  if (!value.contacts.every(contactRowValid)) return TEXT.contacts;
  if (!value.relationships.every(relationshipRowValid)) {
    return TEXT.relationships;
  }
  if (!giftRowsValid(value.gifts)) return TEXT.gifts;
  return undefined;
}
