import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text } from "react-native";
import { Stack, useRouter } from "expo-router";
import { type EntityType, parseTagNames } from "@leapsake/schema";
import { EntityFormSections } from "../components/EntityFormSections";
import { EntityTypeToggle } from "../components/EntityTypeToggle";
import { useHeaderSave } from "../components/HeaderSave";
import { personDraftToInput } from "../components/PersonFields";
import { petDraftToInput } from "../components/PetFields";
import { useCore } from "../lib/core-context";
import {
  type EntityFormValue,
  emptyEntityForm,
  entityFormValid,
} from "../lib/entity-form";
import { applyEntityForm } from "../lib/entity-form-apply";
import { styles } from "../lib/styles";

/**
 * Add a person or a pet — the single destination behind **New** on People &
 * Pets. It replaced a chooser screen that asked "person, pet, or import?" with
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
 * contacts, holidays, relationships, gifts — because they are keyed to a bearer
 * id that doesn't exist until the entity is written. That body is
 * {@link EntityFormSections}; {@link applyEntityForm} writes it in one pass once
 * the record exists. A relationship's *other* end needs nothing from the subject
 * either — it is an already-saved person or pet, or a name typed past the end of
 * the list, which becomes an unpublished entity when the batch is written — so
 * it stages like the rest.
 *
 * **This is the last whole-record form, and deliberately so.** Every part of a
 * *saved* person or pet is edited on a small screen of its own, each with a Save
 * that writes one thing. Here nothing is real yet and everything is provisional,
 * so one Save for the lot is the honest shape; there is no half-created person
 * to leave a milestone hanging off.
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

function AddEntityForm({
  type,
  onTypeChange,
}: {
  type: EntityType;
  onTypeChange: (type: EntityType) => void;
}) {
  const core = useCore();
  const router = useRouter();

  const [value, setValue] = useState<EntityFormValue>(emptyEntityForm);
  const [saving, setSaving] = useState(false);

  const isPerson = type === "person";
  const canSave = entityFormValid(type, value);

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const id = isPerson
        ? (
            await core.people.create(
              personDraftToInput(value.person),
              parseTagNames(value.person.tags),
            )
          ).id
        : (
            await core.pets.create(
              petDraftToInput(value.pet),
              parseTagNames(value.pet.tags),
            )
          ).id;

      // Everything staged, against the entity that now exists — every row a
      // create, since nothing was there before.
      const failed = await applyEntityForm(core, type, id, value);
      if (failed.length > 0) {
        Alert.alert(
          "Saved, but not everything",
          `Couldn't save ${failed.join(", ")}. You can add ${failed.length === 1 ? "it" : "them"} again from the page you're about to land on.`,
        );
      }

      if (isPerson) {
        // Detection runs at the moment the duplicate is created, while the user
        // still remembers both entries and can act on them — but only when there
        // is something to resolve, and only *after* the staged sections land, so
        // the review compares finished records. Either way this screen is
        // **replaced**, so back returns home rather than to a filled-in form; the
        // review screen's "Not now" then replaces itself with the detail page.
        const matches = await core.duplicates.findFor(id).catch(() => []);
        router.replace(
          matches.length > 0 ? `/duplicates?for=${id}` : `/people/${id}`,
        );
      } else {
        router.replace(`/pets/${id}`);
      }
    } catch (e) {
      Alert.alert("Couldn't save", String(e));
      setSaving(false);
    }
  }

  // Both stable across a keystroke, so typing never reaches the navigator — see
  // {@link useHeaderSave}.
  const headerRight = useHeaderSave({
    canSave,
    saving,
    onPress: () => void save(),
  });
  const title = isPerson ? "Add person" : "Add pet";
  const options = useMemo(() => ({ title, headerRight }), [title, headerRight]);

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <EntityTypeToggle value={type} onChange={onTypeChange} />

        <EntityFormSections type={type} value={value} onChange={setValue} />

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
