import type { EntityType } from "@leapsake/schema";
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
import {
  type PersonDraft,
  emptyPersonDraft,
  personDraftValid,
} from "../components/PersonFields";
import {
  type PetDraft,
  emptyPetDraft,
  petDraftValid,
} from "../components/PetFields";

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
    person: emptyPersonDraft(),
    pet: emptyPetDraft(),
    milestones: [],
    contacts: [],
    relationships: [],
    holidays: [],
    gifts: [],
  };
}

/**
 * Whether the form would pass the schema — the Save gate.
 *
 * The record's own fields, plus every staged row that is edited **in place**.
 * Those rows used to reach the form only through a sub-form that had already
 * validated them, so a staged row was valid by construction; now they are typed
 * straight into the list and can sit half-finished, which is a thing to fix
 * rather than to write. The exception each `*RowValid` makes is for a row nobody
 * has filled in at all — the stray "Add" tap, which the write skips instead.
 *
 * Holidays are absent because a holiday row cannot be half-said: it is a pick.
 * Gifts used to be absent for a like reason — the sub-form that staged them had
 * already insisted on a name. Now that a gift is typed straight into the list it
 * can sit there having been given a link but never named, which is a thing to fix
 * rather than write.
 */
export function entityFormValid(
  type: EntityType,
  value: EntityFormValue,
): boolean {
  const own =
    type === "person"
      ? personDraftValid(value.person)
      : petDraftValid(value.pet);
  return (
    own &&
    value.contacts.every(contactRowValid) &&
    value.milestones.every(milestoneRowValid) &&
    value.relationships.every(relationshipRowValid) &&
    giftRowsValid(value.gifts)
  );
}
