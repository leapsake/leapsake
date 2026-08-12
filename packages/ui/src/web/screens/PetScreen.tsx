import type {
  GiftIdea,
  MilestoneTimelineEntry,
  Pet,
  RelationshipNeighbor,
  Reminder,
  Tag,
} from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import type { GivenRow, SuggestionRow } from "../gifts/ports.js";
import { Breadcrumbs, type Crumb } from "../primitives/Breadcrumbs.js";
import { DetailList } from "../primitives/DetailList.js";
import { GenderValue, type GenderResult } from "../primitives/GenderValue.js";
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
 * A pet's page. The same shape as {@link PersonScreen} minus what pets don't
 * have: no contact methods, no merge, and a single name rather than three.
 */
export function PetScreen({
  trail,
  pet,
  gender,
  tags,
  relationships,
  timeline,
  mentionedIn,
  holidays,
  giftSuggestions,
  giftsGiven,
  giftIdeaPool,
  onSetObserves,
  onChanged,
}: {
  trail: Crumb[];
  pet: Pet;
  gender: GenderResult;
  tags: readonly Tag[];
  relationships: readonly RelationshipNeighbor[];
  timeline: readonly MilestoneTimelineEntry[];
  mentionedIn: readonly Reminder[];
  holidays: readonly BearerHoliday[];
  giftSuggestions: readonly SuggestionRow[];
  giftsGiven: readonly GivenRow[];
  giftIdeaPool: readonly GiftIdea[];
  onSetObserves: (holidayId: string, observes: boolean) => Promise<unknown>;
  onChanged: () => void;
}) {
  const { Link } = useUi();
  const m = useMessages();
  const basePath = `/pets/${pet.id}`;

  return (
    <main>
      <Breadcrumbs trail={trail} />

      <header>
        <h1>{pet.name}</h1>
        <Link href={`${basePath}/edit`}>{m.common.edit}</Link>{" "}
        <Link href={`${basePath}/delete`}>{m.common.delete}</Link>
      </header>

      <DetailList
        details={[
          { term: m.pet.name, value: pet.name },
          { term: m.gender.fieldLabel, value: <GenderValue gender={gender} /> },
        ]}
      />

      <MilestonesSection
        bearerType="pet"
        bearerId={pet.id}
        entries={timeline}
      />

      <RelationshipsSection
        subjectType="pet"
        subjectId={pet.id}
        relationships={relationships}
      />

      <HolidaysSection
        bearerType="pet"
        bearerId={pet.id}
        holidays={holidays}
        onSetObserves={onSetObserves}
        onChanged={onChanged}
      />

      <GiftsSection
        recipientType="pet"
        recipientId={pet.id}
        recipientLabel={pet.name}
        suggestions={giftSuggestions}
        gifts={giftsGiven}
        ideaPool={giftIdeaPool}
        onChanged={onChanged}
      />

      <TagsSection bearerType="pet" bearerId={pet.id} tags={tags} />

      <MentionedInSection reminders={mentionedIn} />

      <DetailList
        details={[
          { term: m.pet.created, value: formatTimestamp(pet.createdAt) },
          { term: m.pet.updated, value: formatTimestamp(pet.updatedAt) },
        ]}
      />
    </main>
  );
}
