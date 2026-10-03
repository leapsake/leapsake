import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type EntityType, personInputOf, petInputOf } from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { EntityFormSections } from "../components/EntityFormSections";
import { FormScrollView } from "../components/FormScrollView";
import { useHeaderSave } from "../components/HeaderSave";
import { useCore } from "../lib/core-context";
import {
  type EntityFormValue,
  emptyEntityForm,
  entityFormProblem,
  hasStagedRows,
  switchedEntityForm,
} from "../lib/entity-form";
import { applyEntityForm } from "../lib/entity-form-apply";
import { entityHref } from "../lib/record-title";
import { styles } from "../lib/styles";

const TEXT = {
  person: {
    title: "Add person",
    switchLink: "Adding a pet instead?",
    switchConfirm: "Switch to a pet?",
  },
  pet: {
    title: "Add pet",
    switchLink: "Adding a person instead?",
    switchConfirm: "Switch to a person?",
  },
  switchConfirmBody:
    "The name, gender and tags come with you. Everything added below them will be cleared.",
  switchConfirmAction: "Switch",
  cancel: "Cancel",
} as const;

const OTHER_TYPE: Record<EntityType, EntityType> = {
  person: "pet",
  pet: "person",
};

/**
 * Add a person, or a pet with `?type=pet`, staging every section until the
 * record exists; the one whole-record form, as a saved one is edited in parts.
 */
export default function AddScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const [form, setForm] = useState(() => {
    const type: EntityType = params.type === "pet" ? "pet" : "person";
    return { type, initial: emptyEntityForm() };
  });

  // Keyed on the type, so a switch starts a fresh form from what it carries.
  return (
    <AddEntityForm
      key={form.type}
      type={form.type}
      initial={form.initial}
      onSwitch={(value) =>
        setForm({
          type: OTHER_TYPE[form.type],
          initial: switchedEntityForm(form.type, value),
        })
      }
    />
  );
}

function AddEntityForm({
  type,
  initial,
  onSwitch,
}: {
  type: EntityType;
  initial: EntityFormValue;
  onSwitch: (value: EntityFormValue) => void;
}) {
  const core = useCore();
  const m = useMessages();
  const router = useRouter();

  const [value, setValue] = useState<EntityFormValue>(initial);
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
          m.addRecord.partialSaveTitle,
          m.addRecord.partialSaveBody(failed),
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
  function switchType() {
    if (!hasStagedRows(value)) {
      onSwitch(value);
      return;
    }
    Alert.alert(TEXT[type].switchConfirm, TEXT.switchConfirmBody, [
      { text: TEXT.cancel, style: "cancel" },
      {
        text: TEXT.switchConfirmAction,
        style: "destructive",
        onPress: () => onSwitch(value),
      },
    ]);
  }

  const title = TEXT[type].title;
  const options = useMemo(() => ({ title, headerRight }), [title, headerRight]);

  return (
    <>
      <Stack.Screen options={options} />
      <FormScrollView contentContainerStyle={styles.screen}>
        <Pressable
          accessibilityRole="button"
          testID="add-switch-type"
          onPress={switchType}
          style={local.switchLink}
        >
          <Text style={styles.link}>{TEXT[type].switchLink}</Text>
        </Pressable>

        <EntityFormSections type={type} value={value} onChange={setValue} />
      </FormScrollView>
    </>
  );
}

const local = StyleSheet.create({
  // A full-height tap target for a one-line link.
  switchLink: { minHeight: 44, justifyContent: "center" },
});
