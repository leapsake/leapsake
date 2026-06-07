import { type ContactMethod, formatPostalAddress } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

/** The person the contact method being removed hangs off of. */
interface Subject {
  id: string;
  label: string;
}

/** A short description of the method being removed, for the confirmation copy. */
function describe(entry: ContactMethod): string {
  const labelText = entry.method.label;
  if (entry.kind === "email")
    return `${labelText} email ${entry.method.address}`;
  if (entry.kind === "phone")
    return `${labelText} phone ${entry.method.number}`;
  return `${labelText} address (${formatPostalAddress(entry.method)})`;
}

export function ContactMethodDelete() {
  const { subject, entry } = useLoaderData() as {
    subject: Subject;
    entry: ContactMethod;
  };
  const subjectPath = `/people/${subject.id}`;
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, to: subjectPath },
          { label: "Remove contact" },
        ]}
      />
      <h1>Remove contact method?</h1>
      <p>
        Remove {describe(entry)} from {subject.label}?
      </p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Remove</button>{" "}
          <Link to={subjectPath}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
