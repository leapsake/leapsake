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
import { PetScreen, type GenderResult } from "@leapsake/ui/web";
import { useLoaderData, useRevalidator } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";

/** The route container for a pet's page — see {@link PersonView} for the shape. */
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
  const revalidator = useRevalidator();

  return (
    <PetScreen
      trail={[homeCrumb]}
      pet={pet}
      gender={gender}
      tags={tags}
      relationships={relationships}
      timeline={timeline}
      mentionedIn={mentionedIn}
      holidays={holidays}
      giftSuggestions={giftSuggestions}
      giftsGiven={giftsGiven}
      giftIdeaPool={giftIdeaPool}
      onSetObserves={(holidayId, observes) =>
        window.api.holidays.setObservers(holidayId, [
          { bearerType: "pet", bearerId: pet.id, observes },
        ])
      }
      onChanged={() => revalidator.revalidate()}
    />
  );
}
