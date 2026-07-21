import type { BearerHolidayCandidate } from "@leapsake/core";
import type {
  MilestoneTimelineEntry,
  Pet,
  RelationshipNeighbor,
  Reminder,
  Tag,
} from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { GenderValue, type GenderResult } from "../components/GenderValue";
import { HolidaysSection } from "../components/HolidaysSection";
import { MentionedInSection } from "../components/MentionedInSection";
import { MilestonesSection } from "../components/MilestonesSection";
import { RelationshipsSection } from "../components/RelationshipsSection";
import { TagsSection } from "../components/TagsSection";

/** Render an epoch-ms timestamp in the user's locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PetView() {
  const { pet, tags, relationships, gender, timeline, mentionedIn, holidays } =
    useLoaderData() as {
      pet: Pet;
      tags: Tag[];
      relationships: RelationshipNeighbor[];
      gender: GenderResult;
      timeline: MilestoneTimelineEntry[];
      mentionedIn: Reminder[];
      holidays: BearerHolidayCandidate[];
    };

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb]} />

      <header>
        <h1>{pet.name}</h1>
        <Link to={`/pets/${pet.id}/edit`}>Edit</Link>{" "}
        <Link to={`/pets/${pet.id}/delete`}>Delete</Link>
      </header>

      <dl>
        <dt>Name</dt>
        <dd>{pet.name}</dd>
        <dt>Gender</dt>
        <dd>
          <GenderValue gender={gender} />
        </dd>
      </dl>

      <RelationshipsSection
        subjectType="pet"
        subjectId={pet.id}
        relationships={relationships}
      />

      <MilestonesSection
        bearerType="pet"
        bearerId={pet.id}
        entries={timeline}
      />

      <HolidaysSection bearerType="pet" bearerId={pet.id} holidays={holidays} />

      <TagsSection bearerType="pet" bearerId={pet.id} tags={tags} />

      <MentionedInSection reminders={mentionedIn} />

      <dl>
        <dt>Created</dt>
        <dd>{formatTimestamp(pet.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatTimestamp(pet.updatedAt)}</dd>
      </dl>
    </main>
  );
}
