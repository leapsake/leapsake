import type { Person, Tag } from "@leapsake/schema";
import { fullName, tagLabel } from "@leapsake/schema";
import { Breadcrumbs } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { PersonForm } from "../components/PersonForm";
import { homeCrumb } from "../lib/crumbs";

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
        submitLabel="Save"
        cancelTo={`/people/${person.id}`}
      />
    </main>
  );
}
