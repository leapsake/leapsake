import type {
  BearerHolidayCandidate,
  GiftForRecipient,
  PersonView,
  PetView,
} from "@leapsake/core";
import type { EntityType } from "@leapsake/schema";
import { ContactsSection } from "./ContactsSection";
import { GiftsSection } from "./GiftsSection";
import { HolidaysSection } from "./HolidaysSection";
import { MilestonesSection } from "./MilestonesSection";
import { RecordSection } from "./RecordSection";
import { RelationshipsSection } from "./RelationshipsSection";
import { TagsField } from "./TagsField";

const PATH: Record<EntityType, string> = { person: "people", pet: "pets" };

/** What the sections show: a person's or pet's view, or a draft's blanks. */
export type RecordFactsView = Pick<
  PersonView | PetView,
  "tags" | "timeline" | "relationships"
> &
  Partial<Pick<PersonView, "contactMethods">>;

/**
 * Everything a person or pet gathers, each part with its own ➕: the same on
 * their page and while they are being added.
 */
export function RecordFacts({
  type,
  id,
  subjectName,
  view,
  holidays,
  gifts,
  onChanged,
}: {
  type: EntityType;
  id: string;
  subjectName: string;
  view: RecordFactsView;
  holidays: BearerHolidayCandidate[];
  gifts: GiftForRecipient[];
  onChanged: () => void;
}) {
  const { tags, timeline, relationships } = view;
  return (
    <>
      {type === "person" && (
        <ContactsSection
          ownerId={id}
          subjectName={subjectName}
          methods={view.contactMethods ?? []}
          onChanged={onChanged}
        />
      )}

      <MilestonesSection
        bearerType={type}
        bearerId={id}
        entries={timeline}
        onChanged={onChanged}
      />

      <RelationshipsSection
        subjectType={type}
        subjectId={id}
        relationships={relationships}
        onChanged={onChanged}
      />

      <HolidaysSection
        bearerType={type}
        bearerId={id}
        holidays={holidays}
        onChanged={onChanged}
      />

      <GiftsSection
        recipientType={type}
        recipientId={id}
        gifts={gifts}
        onChanged={onChanged}
      />

      <RecordSection
        title="Tags"
        link={{
          href: `/${PATH[type]}/${id}/tags/edit`,
          what: "tags",
          action: tags.length === 0 ? "add" : "edit",
        }}
      >
        <TagsField tags={tags} />
      </RecordSection>
    </>
  );
}
