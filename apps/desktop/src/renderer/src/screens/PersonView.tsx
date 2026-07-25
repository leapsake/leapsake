import type {
  BearerHolidayCandidate,
  DuplicateCandidate,
  GiftForRecipient,
  GiftSuggestionForRecipient,
} from "@leapsake/core";
import type {
  ContactMethod,
  GiftIdea,
  MilestoneTimelineEntry,
  Person,
  RelationshipNeighbor,
  Reminder,
  Tag,
} from "@leapsake/schema";
import { fullName } from "@leapsake/schema";
import {
  Breadcrumbs,
  ContactMethodsSection,
  DetailList,
  GenderValue,
  HolidaysSection,
  MentionedInSection,
  MilestonesSection,
  RelationshipsSection,
  TagsSection,
  type GenderResult,
} from "@leapsake/ui/web";
import { Link, useLoaderData, useRevalidator } from "react-router-dom";
import { GiftsSection } from "../components/GiftsSection";
import { homeCrumb } from "../lib/crumbs";

/** Render an epoch-ms timestamp in the user's locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PersonView() {
  const {
    person,
    tags,
    relationships,
    gender,
    timeline,
    contactMethods,
    mentionedIn,
    holidays,
    giftSuggestions,
    giftIdeaPool,
    giftsGiven,
    duplicateCandidates,
  } = useLoaderData() as {
    person: Person;
    tags: Tag[];
    relationships: RelationshipNeighbor[];
    gender: GenderResult;
    timeline: MilestoneTimelineEntry[];
    contactMethods: ContactMethod[];
    mentionedIn: Reminder[];
    holidays: BearerHolidayCandidate[];
    giftSuggestions: GiftSuggestionForRecipient[];
    giftIdeaPool: GiftIdea[];
    giftsGiven: GiftForRecipient[];
    duplicateCandidates: DuplicateCandidate[];
  };
  // The Holidays section writes directly rather than through a route action, so
  // it re-reads this screen's loader data itself once a write lands.
  const revalidator = useRevalidator();

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb]} />

      {/* Both halves of an unresolved pair carry this, so the way back to the
          review is on whichever person the user happens to open. It stays until
          the pair is merged or marked "not the same" — the only two things that
          take it out of the candidate set. */}
      {duplicateCandidates.length > 0 && (
        <p role="status">
          {duplicateCandidates.length === 1
            ? "Someone else in your list looks like the same person."
            : `${duplicateCandidates.length} other people in your list look like the same person.`}{" "}
          <Link to={`/duplicates?for=${person.id}`}>Review</Link>
        </p>
      )}

      <header>
        <h1>{fullName(person)}</h1>
        <Link to={`/people/${person.id}/edit`}>Edit</Link>{" "}
        <Link to={`/people/${person.id}/merge`}>Merge</Link>{" "}
        <Link to={`/people/${person.id}/delete`}>Delete</Link>
      </header>

      <DetailList
        details={[
          { term: "First name", value: person.firstName },
          { term: "Middle name", value: person.middleName ?? "—" },
          { term: "Last name", value: person.lastName },
          { term: "Gender", value: <GenderValue gender={gender} /> },
        ]}
      />

      <ContactMethodsSection personId={person.id} methods={contactMethods} />

      <RelationshipsSection
        subjectType="person"
        subjectId={person.id}
        relationships={relationships}
      />

      <MilestonesSection
        bearerType="person"
        bearerId={person.id}
        entries={timeline}
      />

      <HolidaysSection
        bearerType="person"
        bearerId={person.id}
        holidays={holidays}
        onSetObserves={(holidayId, observes) =>
          window.api.holidays.setObservers(holidayId, [
            { bearerType: "person", bearerId: person.id, observes },
          ])
        }
        onChanged={() => revalidator.revalidate()}
      />

      <GiftsSection
        recipientType="person"
        recipientId={person.id}
        recipientLabel={fullName(person)}
        suggestions={giftSuggestions}
        gifts={giftsGiven}
        ideaPool={giftIdeaPool}
      />

      <TagsSection bearerType="person" bearerId={person.id} tags={tags} />

      <MentionedInSection reminders={mentionedIn} />

      <DetailList
        details={[
          { term: "Created", value: formatTimestamp(person.createdAt) },
          { term: "Updated", value: formatTimestamp(person.updatedAt) },
        ]}
      />
    </main>
  );
}
