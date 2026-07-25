import type { Person, Tag } from "@leapsake/schema";
import { fullName } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

export function PersonDelete() {
  const { person } = useLoaderData() as { person: Person; tags: Tag[] };
  const name = fullName(person);
  const personPath = `/people/${person.id}`;

  return (
    <ConfirmDelete
      trail={[homeCrumb, { label: name, href: personPath }]}
      heading={`Delete ${name}?`}
      confirmLabel="Delete"
      cancelTo={personPath}
      submitting={useSubmitting()}
    >
      Are you sure you want to delete {name}?
    </ConfirmDelete>
  );
}
