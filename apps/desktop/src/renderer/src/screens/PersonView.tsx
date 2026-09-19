import type {
  BearerHolidayCandidate,
  DuplicateCandidate,
  GiftForRecipient,
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
import { PersonScreen, type GenderResult } from "@leapsake/ui/web";
import { useLoaderData, useRevalidator } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";

/**
 * Hands the loader's data to {@link PersonScreen}. Writes outside a route
 * action re-read it through `revalidator`.
 */
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
    giftIdeaPool: GiftIdea[];
    giftsGiven: GiftForRecipient[];
    duplicateCandidates: DuplicateCandidate[];
  };
  const revalidator = useRevalidator();

  return (
    <PersonScreen
      trail={[homeCrumb]}
      person={person}
      gender={gender}
      tags={tags}
      relationships={relationships}
      timeline={timeline}
      contactMethods={contactMethods}
      mentionedIn={mentionedIn}
      holidays={holidays}
      giftsGiven={giftsGiven}
      giftIdeaPool={giftIdeaPool}
      duplicateCount={duplicateCandidates.length}
      onSetObserves={(holidayId, observes) =>
        window.api.holidays.setObservers(holidayId, [
          { bearerType: "person", bearerId: person.id, observes },
        ])
      }
      onChanged={() => revalidator.revalidate()}
    />
  );
}
