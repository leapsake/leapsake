import type {
  BearerHolidayCandidate,
  GiftForRecipient,
  GiftSuggestionForRecipient,
} from "@leapsake/core";
import type {
  GiftIdea,
  MilestoneTimelineEntry,
  Pet,
  RelationshipNeighbor,
  Reminder,
  Tag,
} from "@leapsake/schema";
import {
  Breadcrumbs,
  DetailList,
  GenderValue,
  MentionedInSection,
  MilestonesSection,
  RelationshipsSection,
  TagsSection,
  type GenderResult,
} from "@leapsake/ui/web";
import { Link, useLoaderData } from "react-router-dom";
import { GiftsSection } from "../components/GiftsSection";
import { HolidaysSection } from "../components/HolidaysSection";
import { homeCrumb } from "../lib/crumbs";

/** Render an epoch-ms timestamp in the user's locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PetView() {
  const {
    pet,
    tags,
    relationships,
    gender,
    timeline,
    mentionedIn,
    holidays,
    giftSuggestions,
    giftIdeaPool,
    giftsGiven,
  } = useLoaderData() as {
    pet: Pet;
    tags: Tag[];
    relationships: RelationshipNeighbor[];
    gender: GenderResult;
    timeline: MilestoneTimelineEntry[];
    mentionedIn: Reminder[];
    holidays: BearerHolidayCandidate[];
    giftSuggestions: GiftSuggestionForRecipient[];
    giftIdeaPool: GiftIdea[];
    giftsGiven: GiftForRecipient[];
  };

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb]} />

      <header>
        <h1>{pet.name}</h1>
        <Link to={`/pets/${pet.id}/edit`}>Edit</Link>{" "}
        <Link to={`/pets/${pet.id}/delete`}>Delete</Link>
      </header>

      <DetailList
        details={[
          { term: "Name", value: pet.name },
          { term: "Gender", value: <GenderValue gender={gender} /> },
        ]}
      />

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

      <GiftsSection
        recipientType="pet"
        recipientId={pet.id}
        recipientLabel={pet.name}
        suggestions={giftSuggestions}
        gifts={giftsGiven}
        ideaPool={giftIdeaPool}
      />

      <TagsSection bearerType="pet" bearerId={pet.id} tags={tags} />

      <MentionedInSection reminders={mentionedIn} />

      <DetailList
        details={[
          { term: "Created", value: formatTimestamp(pet.createdAt) },
          { term: "Updated", value: formatTimestamp(pet.updatedAt) },
        ]}
      />
    </main>
  );
}
