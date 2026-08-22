import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import type {
  BearerHolidayCandidate,
  GiftForRecipient,
  PersonView,
  PetView,
} from "@leapsake/core";
import {
  type EntityType,
  type Milestone,
  type ReminderRuleInput,
  type Tag,
  fullName,
  parseTagNames,
  tagLabel,
} from "@leapsake/schema";
import type { PartyOption } from "@leapsake/ui/headless";
import { splitBearerHolidays } from "@leapsake/view-models";
import { EntityFormSections } from "./EntityFormSections";
import { useHeaderSave } from "./HeaderSave";
import { personDraftFrom, personDraftToInput } from "./PersonFields";
import { petDraftFrom, petDraftToInput } from "./PetFields";
import { stagedContactOf } from "./StagedContactsSection";
import { emptyGiftEdits } from "./StagedGiftsSection";
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
 *
 * ### Deleting
 *
 * **Delete lives here**, at the foot of the form, and not on the detail screen —
 * which is only somewhere you look. Changing the record is what this screen is
 * for, and deleting it is the largest of those changes; putting it under the
 * reading page meant every glance at a person ended at a destructive button.
 * Unlike everything above it, it does not wait for Save: it asks, and then it
 * acts, discarding whatever edits are in the form — there is nothing to keep
 * about a record that is going away.
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
  const [savedGifts, setSavedGifts] = useState<GiftForRecipient[] | null>(null);
  // Who the form is about, as the Gifts section wants it: only its label is
  // needed here, and only to say who was already given something.
  const [subject, setSubject] = useState<PartyOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [view, holidays, gifts] = await Promise.all([
          isPerson ? core.views.person(id) : core.views.pet(id),
          core.holidays.listForBearer(type, id),
          core.gifts.recipients.listForRecipient(type, id),
        ]);
        if (!active) return;
        if (view === null) {
          setError("Not found.");
          return;
        }
        // The rows show their reminder schedules, so the stored ones have to be
        // in hand before the form is seeded — one query per own milestone, all
        // of them in flight together.
        const own = view.timeline
          .filter((entry) => entry.origin === "own")
          .map((entry) => entry.milestone);
        const schedules = new Map(
          await Promise.all(
            own.map(
              async (m) =>
                [
                  m.id,
                  await core.milestones.reminderSchedule(m.id, m.kind),
                ] as const,
            ),
          ),
        );
        if (!active) return;
        setValue(seedFrom(view, holidays, own, schedules));
        // A separate copy, not the same object: the two must not share the row
        // arrays, or filtering one would empty the other.
        setInitial(seedFrom(view, holidays, own, schedules));
        setSavedGifts(gifts);
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

  // Above the early returns, because they are hooks: a form that is still
  // loading takes the same path as one that is loaded. `canSave` folds the
  // not-yet-loaded case in rather than being computed twice.
  const canSave = value !== null && entityFormValid(type, value);
  const headerRight = useHeaderSave({
    canSave,
    saving,
    onPress: () => void save(),
  });
  const title = isPerson ? "Edit person" : "Edit pet";
  const options = useMemo(() => ({ title, headerRight }), [title, headerRight]);

  // The form's updater, narrowed to the loaded case. `useCallback` because the
  // sections' whole reason for taking an updater is that the one they are given
  // never changes — see {@link EntityFormSections}. A revision arriving before
  // the record has loaded is not possible (nothing is rendered to make one) but
  // is answered by leaving state alone rather than by asserting.
  const revise = useCallback(
    (update: (previous: EntityFormValue) => EntityFormValue) =>
      setValue((previous) => (previous === null ? null : update(previous))),
    [],
  );

  if (error !== null) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      </>
    );
  }

  if (value === null || initial === null) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      </>
    );
  }

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

  function confirmDelete() {
    if (saving) return;
    // `subject` is set alongside `value`, so by the time this button exists the
    // name is in hand; the fallback is only for the type.
    const what = subject?.label ?? (isPerson ? "this person" : "this pet");
    Alert.alert(isPerson ? "Delete person" : "Delete pet", `Delete ${what}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          (isPerson
            ? core.people.softDelete(id)
            : core.pets.softDelete(id)
          ).then(
            // **`dismissTo`, not `back`.** Behind this form is the detail screen
            // of the record just deleted, and behind that the catalog inside the
            // tab navigator (`app/(tabs)/_layout.tsx`) — not a screen to replace
            // this one with, but one already underneath us. This pops down to
            // it, which also takes the deleted record out of history.
            () => router.dismissTo("/people"),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <EntityFormSections
          type={type}
          value={value}
          onChange={revise}
          subject={subject ?? undefined}
          savedGifts={savedGifts ?? undefined}
        />

        <Pressable accessibilityRole="button" onPress={confirmDelete}>
          <Text style={[styles.link, styles.danger]}>
            {isPerson ? "Delete person" : "Delete pet"}
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

/**
 * A saved record as a form value. Everything the detail screen reads becomes a
 * staged row carrying the id it came from, except the milestones a relationship
 * lends the timeline: those live on the edge and are edited from its page.
 *
 * `own` and `schedules` are the record's own milestones and their stored reminder
 * rules, read by the caller — a milestone row is open like every other, so it
 * needs the real schedule rather than a placeholder to show.
 */
function seedFrom(
  view: PersonView | PetView,
  holidays: BearerHolidayCandidate[],
  own: Milestone[],
  schedules: ReadonlyMap<string, ReminderRuleInput[]>,
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
    milestones: own.map((milestone) =>
      stagedMilestoneOf(milestone, schedules.get(milestone.id) ?? []),
    ),
    // Contacts are person-owned; a pet's view carries none to seed from.
    contacts: isPersonView ? view.contactMethods.map(stagedContactOf) : [],
    relationships: view.relationships.map(stagedRelationshipOf),
    holidays: splitBearerHolidays(holidays).observed,
    gifts: emptyGiftEdits(),
  };
}
