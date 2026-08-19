import { useState } from "react";
import { Alert, Pressable, ScrollView, Text } from "react-native";
import { Stack, useRouter } from "expo-router";
import type { CoreApi, HolidayListItem } from "@leapsake/core";
import {
  type EntityType,
  type GiftOccasion,
  milestoneLabel,
  parseTagNames,
} from "@leapsake/schema";
import {
  type GiftOccasionChoice,
  captureRecipientOf,
  occasionKey,
  resolveStagedOccasion,
} from "@leapsake/ui/headless";
import type { ContactFormValue } from "../components/ContactMethodForm";
import { EntityTypeToggle } from "../components/EntityTypeToggle";
import type { StagedGift } from "../components/GiftCaptureForm";
import { HeaderSave } from "../components/HeaderSave";
import {
  type PersonDraft,
  PersonFields,
  emptyPersonDraft,
  personDraftToInput,
  personDraftValid,
} from "../components/PersonFields";
import {
  type PetDraft,
  PetFields,
  emptyPetDraft,
  petDraftToInput,
  petDraftValid,
} from "../components/PetFields";
import { StagedContactsSection } from "../components/StagedContactsSection";
import { StagedGiftsSection } from "../components/StagedGiftsSection";
import { StagedHolidaysSection } from "../components/StagedHolidaysSection";
import {
  type StagedMilestone,
  StagedMilestonesSection,
} from "../components/StagedMilestonesSection";
import {
  type StagedRelationship,
  StagedRelationshipsSection,
} from "../components/StagedRelationshipsSection";
import { TagsInput } from "../components/TagsInput";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * Add a person or a pet — the single destination behind the People & Pets tab's
 * "+ Add". It replaced a chooser screen that asked "person, pet, or import?" with
 * three buttons and then `replace`d itself with one of three forms; the question
 * is now a toggle on the form itself, which opens on **Person** because that is
 * overwhelmingly what a user is adding.
 *
 * Two things the old chooser did that this has to keep doing:
 *
 * - **Import from Contacts** was reachable *only* from it. It is now a link at
 *   the foot of this form (and a row on Menu > Data). The link `push`es rather
 *   than `replace`s, so backing out of the importer returns to a half-filled
 *   form rather than throwing the typing away.
 * - **Nothing stays in the back stack.** The chooser dropped itself so that Back
 *   from a new person's page landed on Home; this screen's `replace` at the end
 *   of {@link save} does the same job.
 *
 * The form **stages** every section the detail pages carry — milestones,
 * contacts, holidays, relationships, gifts — things that used to require saving
 * first and then walking into a section on the detail page. They're held in
 * memory and written immediately after the entity exists, since every one of them
 * is keyed to a bearer id that doesn't exist until then. A relationship's *other*
 * end is an already-saved person or pet, so it stages like the rest; only relating
 * two brand-new entities still needs two passes.
 *
 * Gifts are the one section with a **forward reference** inside the form. A gift's
 * occasion points at a milestone or holiday by id; a staged holiday's id is real
 * (it comes from the catalog), but a staged milestone has none until it's written.
 * So staged milestones carry a client-minted {@link StagedMilestone.key}, the
 * occasion pool offers them under it, and {@link writeExtras} maps key → real id
 * as it writes the milestones and rewrites each gift's occasions before capture.
 * Removing a milestone or holiday a staged gift names clears that occasion — see
 * {@link pruneGiftOccasions}.
 */
export default function AddScreen() {
  const [type, setType] = useState<EntityType>("person");

  // Keyed on the entity type, so flipping the toggle remounts the form and drops
  // every draft and staged entry with it. That's the intended behaviour (the two
  // halves share no fields worth carrying across) and it's also the safe one:
  // both milestone kinds and relationship roles are constrained by the subject's
  // type, so a staged person milestone isn't necessarily a legal pet milestone,
  // and a role picked against a person needn't be one a pet can hold.
  return <AddEntityForm key={type} type={type} onTypeChange={setType} />;
}

/** Everything staged alongside the entity itself, written once it has an id. */
interface StagedExtras {
  milestones: StagedMilestone[];
  contacts: ContactFormValue[];
  holidays: HolidayListItem[];
  relationships: StagedRelationship[];
  gifts: StagedGift[];
}

/**
 * Drop any staged-gift occasion that `valid` no longer contains — what removing a
 * staged milestone or holiday a gift named has to do.
 *
 * Not merely tidiness: {@link SelectField} falls back to its first option when its
 * value matches none, so a stale pointer would *read* as "— none —" while state
 * still held it. For a milestone the write would drop it anyway (its key stops
 * resolving), but a holiday id stays resolvable forever, so without this a gift
 * could be written "for Christmas" against an entity that no longer observes it.
 */
function pruneGiftOccasions(
  gifts: StagedGift[],
  valid: ReadonlySet<string>,
): StagedGift[] {
  const keep = (occasion: GiftOccasion | null) =>
    occasion !== null && valid.has(occasionKey(occasion)) ? occasion : null;
  return gifts.map((gift) => ({
    ...gift,
    givings: gift.givings.map((row) => ({
      ...row,
      occasion: keep(row.occasion),
    })),
    suggestion: {
      ...gift.suggestion,
      occasion: keep(gift.suggestion.occasion),
    },
  }));
}

function AddEntityForm({
  type,
  onTypeChange,
}: {
  type: EntityType;
  onTypeChange: (type: EntityType) => void;
}) {
  const core = useCore();
  const router = useRouter();

  const [personDraft, setPersonDraft] = useState<PersonDraft>(emptyPersonDraft);
  const [petDraft, setPetDraft] = useState<PetDraft>(emptyPetDraft);
  const [milestones, setMilestones] = useState<StagedMilestone[]>([]);
  const [contacts, setContacts] = useState<ContactFormValue[]>([]);
  const [holidays, setHolidays] = useState<HolidayListItem[]>([]);
  const [relationships, setRelationships] = useState<StagedRelationship[]>([]);
  const [gifts, setGifts] = useState<StagedGift[]>([]);
  const [saving, setSaving] = useState(false);

  // Everything a staged gift may name as its occasion, in the order
  // `core.gifts.occasionsFor` returns the saved equivalent: own milestones, then
  // observed holidays. A milestone is offered under its staged key, which
  // `writeExtras` swaps for the real id.
  const giftOccasions: GiftOccasionChoice[] = [
    ...milestones.map((m) => ({
      type: "milestone" as const,
      id: m.key,
      label: milestoneLabel(m),
    })),
    ...holidays.map((h) => ({
      type: "holiday" as const,
      id: h.id,
      label: h.name,
    })),
  ];

  // Removing a milestone or holiday has to clear any staged gift occasion naming
  // it, so the two sections' change handlers go through here rather than setting
  // state directly. The pool is recomputed from the *incoming* lists, since the
  // state this reads hasn't updated yet.
  function pruneAgainst(
    nextMilestones: StagedMilestone[],
    nextHolidays: HolidayListItem[],
  ) {
    const valid = new Set([
      ...nextMilestones.map((m) =>
        occasionKey({ type: "milestone", id: m.key }),
      ),
      ...nextHolidays.map((h) => occasionKey({ type: "holiday", id: h.id })),
    ]);
    setGifts((current) => pruneGiftOccasions(current, valid));
  }

  const isPerson = type === "person";
  const canSave = isPerson
    ? personDraftValid(personDraft)
    : petDraftValid(petDraft);

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const extras: StagedExtras = {
        milestones,
        contacts,
        holidays,
        relationships,
        gifts,
      };
      if (isPerson) {
        const person = await core.people.create(
          personDraftToInput(personDraft),
          parseTagNames(personDraft.tags),
        );
        await writeExtras(core, "person", person.id, extras);
        // Detection runs at the moment the duplicate is created, while the user
        // still remembers both entries and can act on them — but only when there
        // is something to resolve, and only *after* the staged extras land, so
        // the review compares finished records. Either way this screen is
        // **replaced**, so back returns home rather than to a filled-in form; the
        // review screen's "Not now" then replaces itself with the detail page.
        const matches = await core.duplicates
          .findFor(person.id)
          .catch(() => []);
        router.replace(
          matches.length > 0
            ? `/duplicates?for=${person.id}`
            : `/people/${person.id}`,
        );
      } else {
        const pet = await core.pets.create(
          petDraftToInput(petDraft),
          parseTagNames(petDraft.tags),
        );
        await writeExtras(core, "pet", pet.id, extras);
        router.replace(`/pets/${pet.id}`);
      }
    } catch (e) {
      Alert.alert("Couldn't save", String(e));
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: isPerson ? "Add person" : "Add pet",
          headerRight: () => (
            <HeaderSave
              canSave={canSave}
              saving={saving}
              onPress={() => void save()}
            />
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <EntityTypeToggle value={type} onChange={onTypeChange} />

        {isPerson ? (
          <PersonFields draft={personDraft} onChange={setPersonDraft} />
        ) : (
          <PetFields draft={petDraft} onChange={setPetDraft} />
        )}

        <StagedMilestonesSection
          bearerType={type}
          entries={milestones}
          onChange={(next) => {
            setMilestones(next);
            pruneAgainst(next, holidays);
          }}
        />

        {/* Person-only, matching the detail pages: a pet has no Contacts section
          to read these back from. */}
        {isPerson && (
          <StagedContactsSection entries={contacts} onChange={setContacts} />
        )}

        {/* Between Milestones and Holidays, as on both detail pages. */}
        <StagedRelationshipsSection
          subjectType={type}
          entries={relationships}
          onChange={setRelationships}
        />

        <StagedHolidaysSection
          entries={holidays}
          onChange={(next) => {
            setHolidays(next);
            pruneAgainst(milestones, next);
          }}
        />

        <StagedGiftsSection
          occasions={giftOccasions}
          entries={gifts}
          onChange={setGifts}
        />

        {/* Last, below the staged sections rather than up with the name and
            gender: what to tag someone with is a decision you make once the rest
            of the record is in front of you. */}
        <TagsInput
          label="Tags"
          value={isPerson ? personDraft.tags : petDraft.tags}
          onChange={(tags) =>
            isPerson
              ? setPersonDraft({ ...personDraft, tags })
              : setPetDraft({ ...petDraft, tags })
          }
        />

        {/* Pushed, not replaced: backing out of the importer returns here with
            whatever is already typed in. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/import")}
        >
          <Text style={styles.link}>Or import from contacts</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

/**
 * Write everything staged on the form against the entity that now exists.
 *
 * There is no rollback: by the time this runs the person or pet is saved, and
 * deleting it because a phone number failed to write would throw away more than
 * it rescued. A failure is reported by name and the caller carries on to the
 * detail page, where the section that didn't take is one tap from being redone.
 *
 * The order is mostly arbitrary — the sections don't depend on each other — with
 * one exception: **milestones first, gifts last**, because a gift's occasion may
 * name a milestone staged on the same form and needs the id its write produced.
 */
async function writeExtras(
  core: CoreApi,
  bearerType: EntityType,
  bearerId: string,
  { milestones, contacts, holidays, relationships, gifts }: StagedExtras,
): Promise<void> {
  const failed: string[] = [];

  // Staged key → the id the milestone actually got, for the gift occasions below.
  // A milestone that failed simply isn't in the map, which is what makes its
  // occasion resolve to nothing rather than to a dangling id.
  const milestoneIds = new Map<string, string>();
  for (const { key, ...value } of milestones) {
    try {
      const created = await core.milestones.create({
        ...value,
        bearerType,
        bearerId,
      });
      milestoneIds.set(key, created.id);
    } catch {
      failed.push("a milestone");
    }
  }

  // Contacts are person-owned only; the form never stages any for a pet.
  for (const value of contacts) {
    try {
      if (value.kind === "email") {
        await core.contactMethods.emails.create({
          ownerType: "person",
          ownerId: bearerId,
          label: value.label,
          address: value.address,
        });
      } else if (value.kind === "phone") {
        await core.contactMethods.phones.create({
          ownerType: "person",
          ownerId: bearerId,
          label: value.label,
          number: value.number,
          extension: value.extension,
          country: value.country,
          smsCapable: value.smsCapable,
        });
      } else {
        await core.contactMethods.postals.create({
          ownerType: "person",
          ownerId: bearerId,
          label: value.label,
          line1: value.line1,
          line2: value.line2,
          locality: value.locality,
          region: value.region,
          postalCode: value.postalCode,
          country: value.country,
        });
      }
    } catch {
      failed.push(value.label);
    }
  }

  for (const holiday of holidays) {
    try {
      await core.holidays.setObservers(holiday.id, [
        { bearerType, bearerId, observes: true },
      ]);
    } catch {
      failed.push(holiday.name);
    }
  }

  // The new entity is the subject; core implies its own role from the picked
  // other-end role, exactly as the add-relationship screen's save does.
  for (const { otherLabel, ...value } of relationships) {
    try {
      await core.relationships.createFromSubject({
        subjectType: bearerType,
        subjectId: bearerId,
        ...value,
      });
    } catch {
      failed.push(otherLabel);
    }
  }

  // Last, so every staged milestone has been written and can be named. One
  // `capture` per gift: the payload carries one idea and N recipients, and each
  // staged gift is its own idea. The new entity is the sole recipient; the giver
  // still resolves to the self-person inside `capture`.
  for (const gift of gifts) {
    try {
      await core.gifts.capture({
        giftIdea: gift.giftIdea,
        recipients: [
          captureRecipientOf(
            { type: bearerType, id: bearerId },
            gift.givings.map((row) => ({
              ...row,
              occasion: resolveStagedOccasion(row.occasion, milestoneIds),
            })),
            {
              ...gift.suggestion,
              occasion: resolveStagedOccasion(
                gift.suggestion.occasion,
                milestoneIds,
              ),
            },
          ),
        ],
      });
    } catch {
      failed.push(gift.title);
    }
  }

  if (failed.length > 0) {
    Alert.alert(
      "Saved, but not everything",
      `Couldn't save ${failed.join(", ")}. You can add ${failed.length === 1 ? "it" : "them"} again from the page you're about to land on.`,
    );
  }
}
