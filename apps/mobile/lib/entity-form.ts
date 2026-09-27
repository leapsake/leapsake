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

/**
 * A person or pet as the create form holds it — the record's own fields plus
 * everything their detail screen will show beside them, none of it written yet.
 *
 * Staging is what the create screen needs and the *only* thing that needs it:
 * every staged row is keyed to a bearer id that doesn't exist until the record
 * is written, so there is nowhere for a row to go one at a time. A saved record
 * has no such problem, and each part of one is edited on a small screen with a
 * Save of its own — the asymmetry is the point. This shape briefly served both,
 * seeded from a saved record and applied as a diff.
 *
 * Both drafts are kept even though only one is in use: the create screen's toggle
 * flips between them, and holding both means the shared sections don't have to
 * branch on the type to read a name.
 */
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

/**
 * Why the form can't be saved yet, or undefined once it can: the record's own
 * name first, then any staged row left half-filled. An untouched row is skipped.
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
