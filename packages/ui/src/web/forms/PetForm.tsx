import type {
  Pet,
  PetDraft,
  PetDraftErrors,
  SearchHit,
} from "@leapsake/schema";
import type { ReactNode } from "react";
import { usePetForm } from "../../headless/index.js";
import { type Messages, useMessages } from "../../messages/index.js";
import { ChipTextField } from "../fields/ChipTextField.js";
import {
  StagedRelationshipsFields,
  type RelationshipCandidate,
} from "../fields/RelationshipFields.js";
import { FormShell } from "../patterns/FormShell.js";
import { Field } from "../primitives/Field.js";
import { GenderField } from "../primitives/GenderField.js";

/** The pet form; `candidates` adds the create-only Relationships, with one
 *  row open so the owner can be named. */
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
  /** Space-separated existing tag labels; empty on create. */
  tagNames?: string;
  /** Backs the Tags field's picker; must be stable across renders. */
  search: (query: string) => Promise<SearchHit[]>;
  /** Relationship candidates, which show the create-only Relationships. */
  candidates?: readonly RelationshipCandidate[];
  submitLabel: string;
  /** Where Cancel returns to (the list for create, the pet view for edit). */
  cancelTo: string;
  submitting: boolean;
}) {
  const m = useMessages();
  const form = usePetForm(pet, tagNames);

  return (
    <FormShell
      title={title}
      submitLabel={submitLabel}
      cancelTo={cancelTo}
      submitting={submitting}
      problem={petProblem(form.errors, m)}
    >
      <PetFields fields={form.fields} set={form.set} search={search} />
      {candidates && (
        <StagedRelationshipsFields
          subjectType="pet"
          candidates={candidates}
          initialRows={1}
        />
      )}
    </FormShell>
  );
}

function petProblem(errors: PetDraftErrors, m: Messages): string | undefined {
  return errors.name === "required" ? m.petForm.nameRequired : undefined;
}

/** A pet's fields, posted under the names the write path reads. */
export function PetFields({
  fields,
  set,
  search,
}: {
  fields: PetDraft;
  set: <K extends keyof PetDraft>(key: K, value: PetDraft[K]) => void;
  search: (query: string) => Promise<SearchHit[]>;
}) {
  const m = useMessages();

  return (
    <>
      <Field label={m.pet.name}>
        <input
          name="name"
          value={fields.name}
          onChange={(e) => set("name", e.target.value)}
          required
        />
      </Field>{" "}
      <GenderField
        value={fields.gender}
        onChange={(gender) => set("gender", gender)}
      />
      <fieldset>
        <legend>{m.tags.title}</legend>
        <Field label={m.tags.title}>
          <ChipTextField
            name="tags"
            grammar="tags"
            value={fields.tags}
            onChange={(tags) => set("tags", tags)}
            search={search}
            placeholder={m.petForm.tagsPlaceholder}
          />
        </Field>
      </fieldset>
    </>
  );
}
