import type { EntityType } from "@leapsake/schema";
import type { PartyOption } from "@leapsake/ui/headless";
import { PersonFields } from "./PersonFields";
import { PetFields } from "./PetFields";
import { StagedContactsSection } from "./StagedContactsSection";
import { type SavedGifts, StagedGiftsSection } from "./StagedGiftsSection";
import {
  type StagedHoliday,
  StagedHolidaysSection,
} from "./StagedHolidaysSection";
import {
  type StagedMilestone,
  StagedMilestonesSection,
} from "./StagedMilestonesSection";
import { StagedRelationshipsSection } from "./StagedRelationshipsSection";
import { TagsInput } from "./TagsInput";
import {
  type EntityFormValue,
  giftOccasionsOf,
  pruneGiftOccasions,
  validOccasionKeys,
} from "../lib/entity-form";

/**
 * Everything a person or pet form asks, in the order it asks it — the body of
 * both `app/add.tsx` and {@link EntityEditForm}, so that creating a record and
 * revising one are the same screen with different starting values. It renders
 * nothing of its own: no header, no Save, no scroll view; the screen around it
 * owns those.
 *
 * The order is the detail screen's, top to bottom: the record's own fields, then
 * the sections that hang off it, then tags. Tags come **last**, below the
 * sections rather than up with the name and gender, because what to tag somebody
 * with is a decision you make once the rest of the record is in front of you.
 *
 * Contacts are person-only, matching the detail pages: a pet has no Contacts
 * section to read them back from.
 */
export function EntityFormSections({
  type,
  value,
  onChange,
  subject,
  savedGifts,
}: {
  type: EntityType;
  value: EntityFormValue;
  onChange: (value: EntityFormValue) => void;
  /**
   * The record being edited, where there is one. Only the Gifts section asks —
   * a recipient that already exists is a recipient who may already have been
   * given the thing being typed.
   */
  subject?: PartyOption;
  /** The gifts already recorded for this recipient — the edit screen's only. */
  savedGifts?: SavedGifts;
}) {
  const isPerson = type === "person";
  const patch = (fields: Partial<EntityFormValue>) =>
    onChange({ ...value, ...fields });

  /**
   * Milestones and holidays are what gift occasions point at, so a change to
   * either has to take any pointer it invalidates with it. The pool is recomputed
   * from the *incoming* lists, since the value this reads hasn't updated yet.
   */
  function patchOccasionBearers(fields: {
    milestones?: StagedMilestone[];
    holidays?: StagedHoliday[];
  }) {
    const next = { ...value, ...fields };
    onChange({
      ...next,
      gifts: pruneGiftOccasions(next.gifts, validOccasionKeys(next)),
    });
  }

  return (
    <>
      {isPerson ? (
        <PersonFields
          draft={value.person}
          onChange={(person) => patch({ person })}
        />
      ) : (
        <PetFields draft={value.pet} onChange={(pet) => patch({ pet })} />
      )}

      <StagedMilestonesSection
        bearerType={type}
        entries={value.milestones}
        onChange={(milestones) => patchOccasionBearers({ milestones })}
      />

      {isPerson && (
        <StagedContactsSection
          entries={value.contacts}
          onChange={(contacts) => patch({ contacts })}
        />
      )}

      {/* Between Milestones and Holidays, as on both detail pages. */}
      <StagedRelationshipsSection
        subjectType={type}
        entries={value.relationships}
        onChange={(relationships) => patch({ relationships })}
      />

      <StagedHolidaysSection
        entries={value.holidays}
        onChange={(holidays) => patchOccasionBearers({ holidays })}
      />

      <StagedGiftsSection
        occasions={giftOccasionsOf(value)}
        recipient={subject}
        saved={savedGifts}
        value={value.gifts}
        onChange={(gifts) => patch({ gifts })}
      />

      <TagsInput
        label="Tags"
        value={isPerson ? value.person.tags : value.pet.tags}
        onChange={(tags) =>
          isPerson
            ? patch({ person: { ...value.person, tags } })
            : patch({ pet: { ...value.pet, tags } })
        }
      />
    </>
  );
}
