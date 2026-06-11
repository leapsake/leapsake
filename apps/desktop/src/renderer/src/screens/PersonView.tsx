import type {
  ContactMethod,
  MilestoneTimelineEntry,
  Person,
  RelationshipNeighbor,
  Tag,
} from "@leapsake/schema";
import { fullName } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { ContactMethodsSection } from "../components/ContactMethodsSection";
import { GenderValue, type GenderResult } from "../components/GenderValue";
import { MilestonesSection } from "../components/MilestonesSection";
import { RelationshipsSection } from "../components/RelationshipsSection";
import { TagsSection } from "../components/TagsSection";

/** Render an epoch-ms timestamp in the user's locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PersonView() {
  const { person, tags, relationships, gender, timeline, contactMethods } =
    useLoaderData() as {
      person: Person;
      tags: Tag[];
      relationships: RelationshipNeighbor[];
      gender: GenderResult;
      timeline: MilestoneTimelineEntry[];
      contactMethods: ContactMethod[];
    };

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb]} />

      <header>
        <h1>{fullName(person)}</h1>
        <Link to={`/people/${person.id}/edit`}>Edit</Link>{" "}
        <Link to={`/people/${person.id}/delete`}>Delete</Link>
      </header>

      <dl>
        <dt>First name</dt>
        <dd>{person.firstName}</dd>
        <dt>Middle name</dt>
        <dd>{person.middleName ?? "—"}</dd>
        <dt>Last name</dt>
        <dd>{person.lastName}</dd>
        <dt>Gender</dt>
        <dd>
          <GenderValue gender={gender} />
        </dd>
      </dl>

      <ContactMethodsSection personId={person.id} methods={contactMethods} />

      <RelationshipsSection
        subjectType="person"
        subjectId={person.id}
        relationships={relationships}
      />

      <MilestonesSection
        subjectType="person"
        subjectId={person.id}
        entries={timeline}
      />

      <TagsSection subjectType="person" subjectId={person.id} tags={tags} />

      <dl>
        <dt>Created</dt>
        <dd>{formatTimestamp(person.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatTimestamp(person.updatedAt)}</dd>
      </dl>
    </main>
  );
}
