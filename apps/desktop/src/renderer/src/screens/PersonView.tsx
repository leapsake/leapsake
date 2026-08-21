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
 * The route container for a person's page: it reads the loader's data and hands
 * it to the shared {@link PersonScreen}, which owns the rendering. The two writes
 * that don't go through a route action — recording a holiday observance, and the
 * gift sections' inline edits — re-read this screen's data through
 * `revalidator`.
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
