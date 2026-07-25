import type { Person, Tag } from "@leapsake/schema";
import { fullName } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../components/Breadcrumbs";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { useSubmitting } from "../lib/useSubmitting";

export function PersonDelete() {
  const { person } = useLoaderData() as { person: Person; tags: Tag[] };
  const name = fullName(person);
  const personPath = `/people/${person.id}`;

  return (
    <ConfirmDelete
      trail={[homeCrumb, { label: name, to: personPath }]}
      heading={`Delete ${name}?`}
      confirmLabel="Delete"
      cancelTo={personPath}
      submitting={useSubmitting()}
    >
      Are you sure you want to delete {name}?
    </ConfirmDelete>
  );
}
