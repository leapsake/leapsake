import type { Person, SearchHit } from "@leapsake/schema";
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
 * The shared create/edit form for People. The fields are the same on both routes
 * — add one here and both screens gain it. Passing `candidates` enables the
 * create-only Relationships section (edit manages those on the view page, so it
 * omits the prop).
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
  /** Comma-separated existing tag names; empty on create. */
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
  // Controlled, because the Tags field chips what it holds — see ChipTextField.
  const [tags, setTags] = useState(tagNames);

  return (
    <FormShell
      title={title}
      submitLabel={submitLabel}
      cancelTo={cancelTo}
      submitting={submitting}
    >
      <Field label={m.person.firstName}>
        <input name="firstName" defaultValue={person?.firstName} required />
      </Field>{" "}
      <Field label={m.person.middleName}>
        <input name="middleName" defaultValue={person?.middleName ?? ""} />
      </Field>{" "}
      <Field label={m.person.lastName}>
        <input name="lastName" defaultValue={person?.lastName} required />
      </Field>{" "}
      <GenderField value={person?.gender} />
      <fieldset>
        <legend>{m.tags.title}</legend>
        <Field label={m.tags.title}>
          <ChipTextField
            name="tags"
            grammar="tags"
            value={tags}
            onChange={setTags}
            search={search}
            placeholder={m.personForm.tagsPlaceholder}
          />
        </Field>
      </fieldset>
      {candidates && (
        <RelationshipFields
          subjectType="person"
          candidates={candidates}
          submitting={submitting}
        />
      )}
    </FormShell>
  );
}
