import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text } from "react-native";
import { Stack, useRouter } from "expo-router";
import { type EntityType, personInputOf, petInputOf } from "@leapsake/schema";
import { EntityFormSections } from "../components/EntityFormSections";
import { EntityTypeToggle } from "../components/EntityTypeToggle";
import { useHeaderSave } from "../components/HeaderSave";
import { useCore } from "../lib/core-context";
import {
  type EntityFormValue,
  emptyEntityForm,
  entityFormProblem,
} from "../lib/entity-form";
import { applyEntityForm } from "../lib/entity-form-apply";
import { entityHref } from "../lib/record-title";
import { styles } from "../lib/styles";

/**
 * Add a person or pet, staging every section until the record exists; the
 * one whole-record form, since a saved record is edited a part at a time.
 */
export default function AddScreen() {
  const [type, setType] = useState<EntityType>("person");

  // Keyed on the type, so the toggle drops every staged row: milestone kinds
  // and roles legal for a person need not be legal for a pet.
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
  const problem = entityFormProblem(type, value);

  /** The person or pet itself, or null while its draft is invalid. */
  async function createRecord() {
    if (isPerson) {
      const shaped = personInputOf(value.person);
      return shaped.ok ? core.people.create(shaped.input, shaped.tags) : null;
    }
    const shaped = petInputOf(value.pet);
    return shaped.ok ? core.pets.create(shaped.input, shaped.tags) : null;
  }

  async function save() {
    if (problem !== undefined || saving) return;
    setSaving(true);
    try {
      // The whole record, which titles the page this is replaced with.
      const created = await createRecord();
      if (created === null) {
        setSaving(false);
        return;
      }
      const id = created.id;

      const failed = await applyEntityForm(core, type, id, value);
      if (failed.length > 0) {
        Alert.alert(
          "Saved, but not everything",
          `Couldn't save ${failed.join(", ")}. You can add ${failed.length === 1 ? "it" : "them"} again from the page you're about to land on.`,
        );
      }

      if (isPerson) {
        // After the staged rows land, so the review compares finished records.
        // Replaced either way, so Back never returns to a filled-in form.
        const matches = await core.duplicates.findFor(id).catch(() => []);
        router.replace(
          matches.length > 0
            ? `/duplicates?for=${id}`
            : entityHref(type, created),
        );
      } else {
        router.replace(entityHref(type, created));
      }
    } catch (e) {
      Alert.alert("Couldn't save", String(e));
      setSaving(false);
    }
  }

  // Both stable across a keystroke, so typing never reaches the navigator.
  const headerRight = useHeaderSave({
    problem,
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
