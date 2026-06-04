import type { Pet } from "@leapsake/schema";
import type { ReactNode } from "react";
import { Form, Link, useNavigation } from "react-router-dom";

/**
 * The shared create/edit form for Pets. Mirrors {@link PersonForm}: the title
 * and Save/Cancel actions live in the header inside the `<Form>`, and the single
 * `name` field is shared between the `pets/new` and `pets/:id/edit` routes.
 */
export function PetForm({
  title,
  pet,
  submitLabel,
  cancelTo,
}: {
  title: ReactNode;
  pet?: Pet;
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
        </label>
      </fieldset>
    </Form>
  );
}
