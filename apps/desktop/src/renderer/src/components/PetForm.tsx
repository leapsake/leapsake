import type { Pet } from "@leapsake/schema";
import { GenderField } from "@leapsake/ui/web";
import type { ReactNode } from "react";
import { Form, Link, useNavigation } from "react-router-dom";
import { RelationshipFields } from "./RelationshipFields";
import type { RelationshipCandidate } from "./RelationshipForm";

/**
 * The shared create/edit form for Pets. Mirrors {@link PersonForm}: the title
 * and Save/Cancel actions live in the header inside the `<Form>`, and the `name`
 * field is shared between the `pets/new` and `pets/:id/edit` routes. Passing
 * `candidates` enables the create-only Relationships section — it opens with one
 * empty row so a pet's name and owner can be set together.
 */
export function PetForm({
  title,
  pet,
  tagNames = "",
  candidates,
  submitLabel,
  cancelTo,
}: {
  title: ReactNode;
  pet?: Pet;
  /** Comma-separated existing tag names; empty on create. */
  tagNames?: string;
  /** Relationship candidates; when present, the create-mode Relationships section shows. */
  candidates?: RelationshipCandidate[];
  submitLabel: string;
  /** Where Cancel returns to (the list for create, the pet view for edit). */
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <Form method="post">
      <header>
        <h1>{title}</h1>
        <button type="submit" disabled={submitting}>
          {submitLabel}
        </button>{" "}
        <Link to={cancelTo}>Cancel</Link>
      </header>
      <fieldset disabled={submitting}>
        <label>
          Name <input name="name" defaultValue={pet?.name} required />
        </label>{" "}
        <GenderField value={pet?.gender} />
      </fieldset>
      <fieldset disabled={submitting}>
        <legend>Tags</legend>
        <label>
          Tags{" "}
          <input
            name="tags"
            defaultValue={tagNames}
            placeholder="#Friend #Neighbor"
          />
        </label>
      </fieldset>
      {candidates && (
        <RelationshipFields
          subjectType="pet"
          candidates={candidates}
          initialRows={1}
        />
      )}
    </Form>
  );
}
