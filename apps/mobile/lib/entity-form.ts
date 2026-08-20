import {
  type EntityType,
  type GiftOccasion,
  milestoneLabel,
} from "@leapsake/schema";
import { type GiftOccasionChoice, occasionKey } from "@leapsake/ui/headless";
import {
  type StagedContact,
  contactRowValid,
} from "../components/StagedContactsSection";
import type { StagedHoliday } from "../components/StagedHolidaysSection";
import type { StagedGiftEdits } from "../components/StagedGiftsSection";
import { emptyGiftEdits } from "../components/StagedGiftsSection";
import type { StagedMilestone } from "../components/StagedMilestonesSection";
import type { StagedRelationship } from "../components/StagedRelationshipsSection";
import {
  type PersonDraft,
  emptyPersonDraft,
  personDraftValid,
} from "../components/PersonFields";
import {
  type PetDraft,
  emptyPetDraft,
  petDraftValid,
} from "../components/PetFields";

/**
 * A person or pet as a form holds it — the record's own fields plus everything
 * the detail screen shows beside them, none of it written yet.
 *
 * **One shape, two screens.** `app/add.tsx` starts from {@link emptyEntityForm}
 * and turns the result into creates; `components/EntityEditForm.tsx` seeds it
 * from a saved record and turns the difference into creates, updates and
 * deletes. They render the identical body ({@link EntityFormSections}) because a
 * form that adds a milestone and a form that revises one are asking the same
 * questions — the only difference is what the answers are applied to.
 *
 * Both drafts are kept even though only one is in use: the create screen's toggle
 * flips between them, and holding both means the shared sections don't have to
 * branch on the type to read a name.
 */
export interface EntityFormValue {
  person: PersonDraft;
  pet: PetDraft;
  milestones: StagedMilestone[];
  contacts: StagedContact[];
  relationships: StagedRelationship[];
  holidays: StagedHoliday[];
  gifts: StagedGiftEdits;
}

export function emptyEntityForm(): EntityFormValue {
  return {
    person: emptyPersonDraft(),
    pet: emptyPetDraft(),
    milestones: [],
    contacts: [],
    relationships: [],
    holidays: [],
    gifts: emptyGiftEdits(),
  };
}

/**
 * Whether the form would pass the schema — the Save gate.
 *
 * The record's own fields, plus the contact rows, which are the one staged
 * section edited **in place**: everywhere else a row reaches the form only by
 * being submitted through a sub-form that validated it, so a staged row is valid
 * by construction. A contact row is typed straight into the list and can sit
 * there half-finished, which is a thing to fix rather than to write — except when
 * it is untouched, which {@link contactRowValid} lets pass and the write skips.
 */
export function entityFormValid(
  type: EntityType,
  value: EntityFormValue,
): boolean {
  const own =
    type === "person"
      ? personDraftValid(value.person)
      : petDraftValid(value.pet);
  return own && value.contacts.every(contactRowValid);
}

/**
 * Everything a gift on this form may name as its occasion, in the order
 * `core.gifts.occasionsFor` returns the saved equivalent: own milestones, then
 * observed holidays.
 *
 * A milestone is offered under its staged key, which is its **id** when the row
 * came from a saved milestone and a placeholder when it didn't; the screen's
 * write maps every key to a real id (`resolveStagedOccasion`), so the two kinds
 * are indistinguishable here on purpose.
 */
export function giftOccasionsOf(value: EntityFormValue): GiftOccasionChoice[] {
  return [
    ...value.milestones.map((m) => ({
      type: "milestone" as const,
      id: m.key,
      label: milestoneLabel(m),
    })),
    ...value.holidays.map((h) => ({
      type: "holiday" as const,
      id: h.id,
      label: h.name,
    })),
  ];
}

/**
 * Drop any staged gift occasion that `valid` no longer contains — what removing a
 * milestone or holiday a gift names has to do.
 *
 * Not merely tidiness: {@link SelectField} falls back to its first option when
 * its value matches none, so a stale pointer would *read* as "— none —" while
 * state still held it. For a milestone the write would drop it anyway (its key
 * stops resolving), but a holiday id stays resolvable forever, so without this a
 * gift could be written "for Christmas" against an entity that no longer observes
 * it.
 *
 * Only what this form is about to write is pruned — gifts being added, and
 * revisions typed into saved rows. A saved row nobody touched keeps whatever it
 * has stored: rewriting rows the user never opened, because they mention a
 * milestone being removed in the same pass, is a larger promise than the form
 * makes anywhere else.
 */
export function pruneGiftOccasions(
  gifts: StagedGiftEdits,
  valid: ReadonlySet<string>,
): StagedGiftEdits {
  const keep = (occasion: GiftOccasion | null) =>
    occasion !== null && valid.has(occasionKey(occasion)) ? occasion : null;
  return {
    ...gifts,
    added: gifts.added.map((gift) => ({
      ...gift,
      givings: gift.givings.map((row) => ({
        ...row,
        occasion: keep(row.occasion),
      })),
      suggestion: {
        ...gift.suggestion,
        occasion: keep(gift.suggestion.occasion),
      },
    })),
    adornments: Object.fromEntries(
      Object.entries(gifts.adornments).map(([key, pair]) => [
        key,
        { ...pair, occasion: keep(pair.occasion) },
      ]),
    ),
  };
}

/** The occasion keys a form's milestones and holidays currently offer. */
export function validOccasionKeys(value: EntityFormValue): ReadonlySet<string> {
  return new Set(giftOccasionsOf(value).map((o) => occasionKey(o)));
}
