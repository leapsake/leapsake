import type { Person } from "@leapsake/schema";
import type { ReactNode } from "react";
import { Form, Link, useNavigation } from "react-router-dom";

/**
 * The shared create/edit form. The title and Save/Cancel actions live in the
 * header inside the `<Form>` so the submit button stays natively associated;
 * the fields below are shared between the `people/new` and `people/:id/edit`
 * routes — add a field here and both screens gain it.
 */
export function PersonForm({
  title,
  person,
  submitLabel,
  cancelTo,
}: {
  title: ReactNode;
  person?: Person;
  submitLabel: string;
  /** Where Cancel returns to (the list for create, the person view for edit). */
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
          First name{" "}
          <input name="firstName" defaultValue={person?.firstName} required />
        </label>{" "}
        <label>
          Middle name{" "}
          <input name="middleName" defaultValue={person?.middleName ?? ""} />
        </label>{" "}
        <label>
          Last name{" "}
          <input name="lastName" defaultValue={person?.lastName} required />
        </label>
      </fieldset>
    </Form>
  );
}
