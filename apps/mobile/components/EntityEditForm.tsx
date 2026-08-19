import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import type {
  BearerHolidayCandidate,
  PersonView,
  PetView,
} from "@leapsake/core";
import {
  type EntityType,
  type Tag,
  fullName,
  parseTagNames,
  tagLabel,
} from "@leapsake/schema";
import type { PartyOption } from "@leapsake/ui/headless";
import { splitBearerHolidays } from "@leapsake/view-models";
import { EntityFormSections } from "./EntityFormSections";
import { HeaderSave } from "./HeaderSave";
import { personDraftFrom, personDraftToInput } from "./PersonFields";
import { petDraftFrom, petDraftToInput } from "./PetFields";
import { stagedContactOf } from "./StagedContactsSection";
import { type SavedGifts, emptyGiftEdits } from "./StagedGiftsSection";
import { stagedMilestoneOf } from "./StagedMilestonesSection";
import { stagedRelationshipOf } from "./StagedRelationshipsSection";
import { useCore } from "../lib/core-context";
import {
  type EntityFormValue,
  emptyEntityForm,
  entityFormValid,
} from "../lib/entity-form";
import { applyEntityForm } from "../lib/entity-form-apply";
import { styles } from "../lib/styles";

/** The tags of a record as the form types them: labels, space-separated. */
const tagsRawOf = (tags: readonly Tag[]) =>
  tags.map((tag) => tagLabel(tag.name)).join(" ");

/**
 * Revise a person or pet — everything their detail screen shows, on one form,
 * behind that screen's single **Edit**.
 *
 * It is the create screen with a starting point: the same body
 * ({@link EntityFormSections}), the same staged sections, the same one Save. What
 * differs is only what saving means — {@link applyEntityForm} compares the form
 * against the record it was seeded from and writes the difference, so a row
 * added here is a create, a row whose editor was submitted is an update, and a
 * row that is gone is a delete.
 *
 * **Nothing is written until Save**, which is what makes Back a real cancel: a
 * form of half-made decisions is one thought, and the old detail screen — where
 * every section wrote the moment you touched it — had no way to abandon it.
 *
 * ### What the form leaves to the detail screen
 *
 * - **Milestones that belong to a relationship.** They are stored on the edge, not
 *   on this entity, and the relationship's own page owns them; the detail screen
 *   still lists them, read-only, with a link out.
 * - **Reminder schedules for an observed holiday.** They belong to the
 *   observance, which doesn't exist until this form has written it.
 * - **Deleting the record**, which is not an edit and stays where it was.
 *
 * The load is deliberately **one-shot** rather than the app's usual refetch-on-
 * focus ({@link useFocusedData}): a background sync landing mid-edit would
 * otherwise reseed the form under the user's hands and throw away what they had
 * typed.
 */
export function EntityEditForm({ type, id }: { type: EntityType; id: string }) {
  const core = useCore();
  const router = useRouter();
  const isPerson = type === "person";

  // The form as it stands, and the form as it was loaded. The second is what
  // makes a removal legible: a row that has gone from `value` but is still in
  // `initial` is the only trace left of what the user took out.
  const [value, setValue] = useState<EntityFormValue | null>(null);
  const [initial, setInitial] = useState<EntityFormValue | null>(null);
  const [savedGifts, setSavedGifts] = useState<SavedGifts | null>(null);
  // Who the form is about, as the Gifts section wants it: only its label is
  // needed here, and only to say who was already given something.
  const [subject, setSubject] = useState<PartyOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [view, holidays, suggestions, gifts] = await Promise.all([
          isPerson ? core.views.person(id) : core.views.pet(id),
          core.holidays.listForBearer(type, id),
          core.gifts.suggestions.listForRecipient(type, id),
          core.gifts.given.listForRecipient(type, id),
        ]);
        if (!active) return;
        if (view === null) {
          setError("Not found.");
          return;
        }
        setValue(seedFrom(view, holidays));
        // A separate copy, not the same object: the two must not share the row
        // arrays, or filtering one would empty the other.
        setInitial(seedFrom(view, holidays));
        setSavedGifts({ suggestions, gifts });
        setSubject({
          type,
          id,
          label: "person" in view ? fullName(view.person) : view.pet.name,
        });
      } catch (e) {
        if (active) setError(String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [core, id, type, isPerson]);

  if (error !== null) {
    return (
      <>
        <Stack.Screen
          options={{ title: isPerson ? "Edit person" : "Edit pet" }}
        />
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      </>
    );
  }

  if (value === null || initial === null) {
    return (
      <>
        <Stack.Screen
          options={{ title: isPerson ? "Edit person" : "Edit pet" }}
        />
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      </>
    );
  }

  const canSave = entityFormValid(type, value);

  async function save() {
    if (value === null || initial === null || !canSave || saving) return;
    setSaving(true);
    try {
      // The record's own fields and its tags in one call: `update` sets an
      // entity's tags to exactly what it is handed, so they ride along on every
      // write whether or not they were touched.
      if (isPerson) {
        await core.people.update(
          id,
          personDraftToInput(value.person),
          parseTagNames(value.person.tags),
        );
      } else {
        await core.pets.update(
          id,
          petDraftToInput(value.pet),
          parseTagNames(value.pet.tags),
        );
      }

      const failed = await applyEntityForm(core, type, id, value, initial);
      if (failed.length > 0) {
        Alert.alert(
          "Saved, but not everything",
          `Couldn't save ${failed.join(", ")}. You can try ${failed.length === 1 ? "it" : "them"} again from the page you're about to land on.`,
        );
      }
      // Back to the record, which refetches on focus and so reads as the form
      // left it.
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save", String(e));
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: isPerson ? "Edit person" : "Edit pet",
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
        <EntityFormSections
          type={type}
          value={value}
          onChange={setValue}
          subject={subject ?? undefined}
          savedGifts={savedGifts ?? undefined}
        />
      </ScrollView>
    </>
  );
}

/**
 * A saved record as a form value. Everything the detail screen reads becomes a
 * staged row carrying the id it came from, except the milestones a relationship
 * lends the timeline: those live on the edge and are edited from its page.
 */
function seedFrom(
  view: PersonView | PetView,
  holidays: BearerHolidayCandidate[],
): EntityFormValue {
  const tagsRaw = tagsRawOf(view.tags);
  const seeded = emptyEntityForm();
  const isPersonView = "person" in view;
  return {
    ...seeded,
    person: isPersonView
      ? personDraftFrom(view.person, tagsRaw)
      : seeded.person,
    pet: isPersonView ? seeded.pet : petDraftFrom(view.pet, tagsRaw),
    milestones: view.timeline
      .filter((entry) => entry.origin === "own")
      .map((entry) => stagedMilestoneOf(entry.milestone)),
    // Contacts are person-owned; a pet's view carries none to seed from.
    contacts: isPersonView ? view.contactMethods.map(stagedContactOf) : [],
    relationships: view.relationships.map(stagedRelationshipOf),
    holidays: splitBearerHolidays(holidays).observed,
    gifts: emptyGiftEdits(),
  };
}
