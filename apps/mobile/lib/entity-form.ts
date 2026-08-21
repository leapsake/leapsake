import type { EntityType } from "@leapsake/schema";
import {
  type StagedContact,
  contactRowValid,
} from "../components/StagedContactsSection";
import type { StagedHoliday } from "../components/StagedHolidaysSection";
import type { StagedGiftEdits } from "../components/StagedGiftsSection";
import {
  emptyGiftEdits,
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
 * A person or pet as a form holds it — the record's own fields plus everything
 * the detail screen shows beside them, none of it written yet.
 *
 * **One shape, two screens.** `app/add.tsx` starts from {@link emptyEntityForm}
 * and turns the result into creates; `components/EntityEditForm.tsx` seeds it
 * from a saved record and turns the difference into creates, updates and
 * deletes. They render the identical body ({@link EntityFormSections}) because a
 * form that adds a milestone and a form that revises one are asking the same
 * questions — the only difference is what the answers are applied to.
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
  gifts: StagedGiftEdits;
}

export function emptyEntityForm(): EntityFormValue {
  return {
    person: emptyPersonDraft(),
    pet: emptyPetDraft(),
    milestones: [],
    contacts: [],
    relationships: [],
    holidays: [],
    gifts: emptyGiftEdits(),
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
