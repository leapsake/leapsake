import type { EntityType } from "@leapsake/schema";
import { PersonFields } from "./PersonFields";
import { PetFields } from "./PetFields";
import { StagedContactsSection } from "./StagedContactsSection";
import { StagedGiftsSection } from "./StagedGiftsSection";
import { StagedHolidaysSection } from "./StagedHolidaysSection";
import { StagedMilestonesSection } from "./StagedMilestonesSection";
import { StagedRelationshipsSection } from "./StagedRelationshipsSection";
import { TagsInput } from "./TagsInput";
import type { EntityFormValue } from "../lib/entity-form";

/**
 * The create form's body, in the detail page's order, tags last. `onChange`
 * takes an updater, so a keystroke re-renders only its own section.
 */
export function EntityFormSections({
  type,
  value,
  onChange,
}: {
  type: EntityType;
  value: EntityFormValue;
  /** An updater, not a value: a value would change every section's props. */
  onChange: (update: (previous: EntityFormValue) => EntityFormValue) => void;
}) {
  const isPerson = type === "person";
  const { person, pet, milestones, contacts, relationships, holidays, gifts } =
    value;

  const patch = (fields: Partial<EntityFormValue>) =>
    onChange((previous) => ({ ...previous, ...fields }));

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
        onChange={(next) => patch({ milestones: next })}
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
        onChange={(next) => patch({ holidays: next })}
      />

      <StagedGiftsSection
        entries={gifts}
        onChange={(next) => patch({ gifts: next })}
      />

      {/* Tags live on the record's draft, so this writes through it. */}
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
