import type {
  Person,
  PersonDraft,
  PersonDraftErrors,
  SearchHit,
} from "@leapsake/schema";
import type { ReactNode } from "react";
import { usePersonForm } from "../../headless/index.js";
import { type Messages, useMessages } from "../../messages/index.js";
import { ChipTextField } from "../fields/ChipTextField.js";
import {
  StagedRelationshipsFields,
  type RelationshipCandidate,
} from "../fields/RelationshipFields.js";
import { FormShell } from "../patterns/FormShell.js";
import { Field } from "../primitives/Field.js";
import { GenderField } from "../primitives/GenderField.js";

/**
 * The create/edit form for People: {@link usePersonForm}'s draft rendered by
 * {@link PersonFields}. Passing `candidates` adds the create-only Relationships section.
 */
export function PersonForm({
  title,
  person,
  tagNames = "",
  search,
  candidates,
  submitLabel,
  cancelTo,
  submitting,
}: {
  title: ReactNode;
  person?: Person;
  /** Space-separated existing tag labels; empty on create. */
  tagNames?: string;
  /** Backs the Tags field's existing-tag picker; must be stable across renders. */
  search: (query: string) => Promise<SearchHit[]>;
  /** Relationship candidates; when present, the create-mode Relationships section shows. */
  candidates?: readonly RelationshipCandidate[];
  submitLabel: string;
  /** Where Cancel returns to (the list for create, the person view for edit). */
  cancelTo: string;
  submitting: boolean;
}) {
  const m = useMessages();
  const form = usePersonForm(person, tagNames);

  return (
    <FormShell
      title={title}
      submitLabel={submitLabel}
      cancelTo={cancelTo}
      submitting={submitting}
      problem={personProblem(form.errors, m)}
    >
      <PersonFields fields={form.fields} set={form.set} search={search} />
      {candidates && (
        <StagedRelationshipsFields
          subjectType="person"
          candidates={candidates}
        />
      )}
    </FormShell>
  );
}

function personProblem(
  errors: PersonDraftErrors,
  m: Messages,
): string | undefined {
  return errors.name === "required" ? m.personForm.nameRequired : undefined;
}

/**
 * A person's fields, posted under the names the write path reads. No name part
 * is `required`: any one is enough, which HTML can't say, so the action checks.
 */
export function PersonFields({
  fields,
  set,
  search,
}: {
  fields: PersonDraft;
  set: <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) => void;
  search: (query: string) => Promise<SearchHit[]>;
}) {
  const m = useMessages();

  return (
    <>
      <Field label={m.person.firstName}>
        <input
          name="firstName"
          value={fields.firstName}
          onChange={(e) => set("firstName", e.target.value)}
        />
      </Field>{" "}
      <Field label={m.person.middleName}>
        <input
          name="middleName"
          value={fields.middleName}
          onChange={(e) => set("middleName", e.target.value)}
        />
      </Field>{" "}
      <Field label={m.person.lastName}>
        <input
          name="lastName"
          value={fields.lastName}
          onChange={(e) => set("lastName", e.target.value)}
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
            placeholder={m.personForm.tagsPlaceholder}
          />
        </Field>
      </fieldset>
    </>
  );
}
