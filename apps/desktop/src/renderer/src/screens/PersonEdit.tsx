import type { Person, Tag } from "@leapsake/schema";
import { fullName, tagLabel } from "@leapsake/schema";
import { Breadcrumbs, PersonForm } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { searchEntities } from "../lib/search";
import { useSubmitting } from "../lib/useSubmitting";

export function PersonEdit() {
  const { person, tags } = useLoaderData() as { person: Person; tags: Tag[] };
  const name = fullName(person);

  return (
    <main>
      <Breadcrumbs
        trail={[homeCrumb, { label: name, href: `/people/${person.id}` }]}
      />
      <PersonForm
        title={`Edit ${name}`}
        person={person}
        tagNames={tags.map((tag) => tagLabel(tag.name)).join(" ")}
        search={searchEntities}
        submitLabel="Save"
        cancelTo={`/people/${person.id}`}
        submitting={useSubmitting()}
      />
    </main>
  );
}
