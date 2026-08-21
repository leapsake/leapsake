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
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import type { GiftRecipientRow } from "../../headless/index.js";
import { Breadcrumbs, type Crumb } from "../primitives/Breadcrumbs.js";
import { DetailList } from "../primitives/DetailList.js";
import { GenderValue, type GenderResult } from "../primitives/GenderValue.js";
import { ContactMethodsSection } from "../sections/ContactMethodsSection.js";
import { GiftsSection } from "../sections/GiftsSection.js";
import {
  HolidaysSection,
  type BearerHoliday,
} from "../sections/HolidaysSection.js";
import { MentionedInSection } from "../sections/MentionedInSection.js";
import { MilestonesSection } from "../sections/MilestonesSection.js";
import { RelationshipsSection } from "../sections/RelationshipsSection.js";
import { TagsSection } from "../sections/TagsSection.js";
import { formatTimestamp } from "../../headless/index.js";

/**
 * A person's page: who they are, then every section that hangs off them.
 *
 * Purely presentational — every value arrives as a prop and every write leaves
 * through `onChanged` or the gift ports. The host supplies the breadcrumb trail,
 * because which route is “home” is a client decision.
 */
export function PersonScreen({
  trail,
  person,
  gender,
  tags,
  relationships,
  timeline,
  contactMethods,
  mentionedIn,
  holidays,
  giftsGiven,
  giftIdeaPool,
  duplicateCount,
  onSetObserves,
  onChanged,
}: {
  trail: Crumb[];
  person: Person;
  gender: GenderResult;
  tags: readonly Tag[];
  relationships: readonly RelationshipNeighbor[];
  timeline: readonly MilestoneTimelineEntry[];
  contactMethods: readonly ContactMethod[];
  mentionedIn: readonly Reminder[];
  holidays: readonly BearerHoliday[];
  giftsGiven: readonly GiftRecipientRow[];
  giftIdeaPool: readonly GiftIdea[];
  /** How many other people look like this one; 0 hides the review banner. */
  duplicateCount: number;
  onSetObserves: (holidayId: string, observes: boolean) => Promise<unknown>;
  onChanged: () => void;
}) {
  const { Link } = useUi();
  const m = useMessages();
  const name = fullName(person);
  const basePath = `/people/${person.id}`;

  return (
    <main>
      <Breadcrumbs trail={trail} />

      {/* Both halves of an unresolved pair carry this, so the way back to the
          review is on whichever person the user happens to open. It stays until
          the pair is merged or marked “not the same” — the only two things that
          take it out of the candidate set. */}
      {duplicateCount > 0 && (
        <p role="status">
          {m.person.duplicates(duplicateCount)}{" "}
          <Link href={`/duplicates?for=${person.id}`}>
            {m.person.reviewDuplicates}
          </Link>
        </p>
      )}

      <header>
        <h1>{name}</h1>
        <Link href={`${basePath}/edit`}>{m.common.edit}</Link>{" "}
        <Link href={`${basePath}/merge`}>{m.person.merge}</Link>{" "}
        <Link href={`${basePath}/delete`}>{m.common.delete}</Link>
      </header>

      <DetailList
        details={[
          { term: m.person.firstName, value: person.firstName },
          {
            term: m.person.middleName,
            value: person.middleName ?? m.common.none,
          },
          { term: m.person.lastName, value: person.lastName },
          { term: m.gender.fieldLabel, value: <GenderValue gender={gender} /> },
        ]}
      />

      <ContactMethodsSection personId={person.id} methods={contactMethods} />

      <MilestonesSection
        bearerType="person"
        bearerId={person.id}
        entries={timeline}
      />

      <RelationshipsSection
        subjectType="person"
        subjectId={person.id}
        relationships={relationships}
      />

      <HolidaysSection
        bearerType="person"
        bearerId={person.id}
        holidays={holidays}
        onSetObserves={onSetObserves}
        onChanged={onChanged}
      />

      <GiftsSection
        recipientType="person"
        recipientId={person.id}
        recipientLabel={name}
        gifts={giftsGiven}
        ideaPool={giftIdeaPool}
        onChanged={onChanged}
      />

      <TagsSection bearerType="person" bearerId={person.id} tags={tags} />

      <MentionedInSection reminders={mentionedIn} />

      <DetailList
        details={[
          { term: m.person.created, value: formatTimestamp(person.createdAt) },
          { term: m.person.updated, value: formatTimestamp(person.updatedAt) },
        ]}
      />
    </main>
  );
}
