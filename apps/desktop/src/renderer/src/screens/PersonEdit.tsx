import type { Person, Tag } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { PersonForm } from "../components/PersonForm";
import { fullName } from "../lib/fullName";

export function PersonEdit() {
  const { person, tags } = useLoaderData() as { person: Person; tags: Tag[] };
  const name = fullName(person);

  return (
    <main>
      <Breadcrumbs
        trail={[
          { label: "People", to: "/" },
          { label: name, to: `/people/${person.id}` },
        ]}
      />
      <PersonForm
        title={`Edit ${name}`}
        person={person}
        tagNames={tags.map((tag) => tag.name).join(", ")}
        submitLabel="Save"
        cancelTo={`/people/${person.id}`}
      />
    </main>
  );
}
