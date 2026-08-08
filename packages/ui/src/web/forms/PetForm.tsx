import type { Pet, SearchHit } from "@leapsake/schema";
import { type ReactNode, useState } from "react";
import { useMessages } from "../../messages/index.js";
import { ChipTextField } from "../fields/ChipTextField.js";
import {
  RelationshipFields,
  type RelationshipCandidate,
} from "../fields/RelationshipFields.js";
import { FormShell } from "../patterns/FormShell.js";
import { Field } from "../primitives/Field.js";
import { GenderField } from "../primitives/GenderField.js";

/**
 * The shared create/edit form for Pets. Mirrors {@link PersonForm}, with one
 * name rather than three. Passing `candidates` enables the create-only
 * Relationships section, which opens with one empty row so a pet's name and
 * owner can be set together.
 */
export function PetForm({
  title,
  pet,
  tagNames = "",
  search,
  candidates,
  submitLabel,
  cancelTo,
  submitting,
}: {
  title: ReactNode;
  pet?: Pet;
  /** Comma-separated existing tag names; empty on create. */
  tagNames?: string;
  /** Backs the Tags field's existing-tag picker; must be stable across renders. */
  search: (query: string) => Promise<SearchHit[]>;
  /** Relationship candidates; when present, the create-mode Relationships section shows. */
  candidates?: readonly RelationshipCandidate[];
  submitLabel: string;
  /** Where Cancel returns to (the list for create, the pet view for edit). */
  cancelTo: string;
  submitting: boolean;
}) {
  const m = useMessages();
  // Controlled, because the Tags field chips what it holds — see ChipTextField.
  const [tags, setTags] = useState(tagNames);

  return (
    <FormShell
      title={title}
      submitLabel={submitLabel}
      cancelTo={cancelTo}
      submitting={submitting}
    >
      <Field label={m.pet.name}>
        <input name="name" defaultValue={pet?.name} required />
      </Field>{" "}
      <GenderField value={pet?.gender} />
      <fieldset>
        <legend>{m.tags.title}</legend>
        <Field label={m.tags.title}>
          <ChipTextField
            name="tags"
            grammar="tags"
            value={tags}
            onChange={setTags}
            search={search}
            placeholder={m.petForm.tagsPlaceholder}
          />
        </Field>
      </fieldset>
      {candidates && (
        <RelationshipFields
          subjectType="pet"
          candidates={candidates}
          submitting={submitting}
          initialRows={1}
        />
      )}
    </FormShell>
  );
}
