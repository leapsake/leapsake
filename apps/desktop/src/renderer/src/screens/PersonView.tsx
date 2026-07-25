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
import { GenderValue, type GenderResult } from "@leapsake/ui/web";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { ContactMethodsSection } from "../components/ContactMethodsSection";
import { GiftsSection } from "../components/GiftsSection";
import { HolidaysSection } from "../components/HolidaysSection";
import { MentionedInSection } from "../components/MentionedInSection";
import { MilestonesSection } from "../components/MilestonesSection";
import { RelationshipsSection } from "../components/RelationshipsSection";
import { TagsSection } from "../components/TagsSection";

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
        bearerType="person"
        bearerId={person.id}
        entries={timeline}
      />

      <HolidaysSection
        bearerType="person"
        bearerId={person.id}
        holidays={holidays}
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

      <dl>
        <dt>Created</dt>
        <dd>{formatTimestamp(person.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatTimestamp(person.updatedAt)}</dd>
      </dl>
    </main>
  );
}
