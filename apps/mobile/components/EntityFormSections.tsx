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
 *
 * ### Why `onChange` takes an updater
 *
 * Every section is handed one slice of the value and a callback that writes it
 * back. If that callback is built by *reading* the current value — `onChange({
 * ...value, contacts })` — then it depends on the whole form, so it is a new
 * function after every keystroke, so every section's props change, so every
 * section re-renders however carefully the rest is memoized. Measured on a
 * filled-in person that was 441 elements rebuilt per keypress, including all ten
 * of the form's `SelectField`s — which on Android are live native pickers.
 *
 * Taking an **updater** removes the dependency instead of memoizing around it:
 * {@link patch} closes over nothing that changes, so each section keeps the same
 * `onChange` for the life of the form and re-renders only when its own slice
 * does. That is also why the body destructures `value` up front — a prop derived
 * from `value` rather than from a slice would put the dependency straight back.
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
  /** Revise the form. An updater, not a value — see above. */
  onChange: (update: (previous: EntityFormValue) => EntityFormValue) => void;
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
  const { person, pet, milestones, contacts, relationships, holidays, gifts } =
    value;

  const patch = (fields: Partial<EntityFormValue>) =>
    onChange((previous) => ({ ...previous, ...fields }));

  /**
   * Milestones and holidays are what gift occasions point at, so a change to
   * either has to take any pointer it invalidates with it. The pool is recomputed
   * from the *incoming* lists, since the form this is revising hasn't updated yet.
   */
  const patchOccasionBearers = (fields: {
    milestones?: StagedMilestone[];
    holidays?: StagedHoliday[];
  }) =>
    onChange((previous) => {
      const next = { ...previous, ...fields };
      return {
        ...next,
        gifts: pruneGiftOccasions(
          next.gifts,
          validOccasionKeys(next.milestones, next.holidays),
        ),
      };
    });

  return (
    <>
      {isPerson ? (
        <PersonFields
          draft={person}
          onChange={(next) => patch({ person: next })}
        />
      ) : (
        <PetFields draft={pet} onChange={(next) => patch({ pet: next })} />
      )}

      <StagedMilestonesSection
        bearerType={type}
        entries={milestones}
        onChange={(next) => patchOccasionBearers({ milestones: next })}
      />

      {isPerson && (
        <StagedContactsSection
          entries={contacts}
          onChange={(next) => patch({ contacts: next })}
        />
      )}

      {/* Between Milestones and Holidays, as on both detail pages. */}
      <StagedRelationshipsSection
        subjectType={type}
        entries={relationships}
        onChange={(next) => patch({ relationships: next })}
      />

      <StagedHolidaysSection
        entries={holidays}
        onChange={(next) => patchOccasionBearers({ holidays: next })}
      />

      <StagedGiftsSection
        occasions={giftOccasionsOf(milestones, holidays)}
        recipient={subject}
        saved={savedGifts}
        value={gifts}
        onChange={(next) => patch({ gifts: next })}
      />

      {/*
        Tags live on the record's own draft, so this writes through the draft
        rather than beside it — and reads `previous` for the same reason `patch`
        does, since the tags being replaced are the ones in state now.
      */}
      <TagsInput
        label="Tags"
        value={isPerson ? person.tags : pet.tags}
        onChange={(tags) =>
          onChange((previous) =>
            isPerson
              ? { ...previous, person: { ...previous.person, tags } }
              : { ...previous, pet: { ...previous.pet, tags } },
          )
        }
      />
    </>
  );
}
