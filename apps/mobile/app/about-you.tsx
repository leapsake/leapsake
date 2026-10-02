import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import type { EntityRow } from "@leapsake/core";
import { Typeahead } from "../components/Typeahead";
import { usePersonForm } from "@leapsake/ui/headless";
import { PersonFields } from "../components/PersonFields";
import { useCore } from "../lib/core-context";
import { showFormProblem } from "../lib/form-problem";
import { entityHref } from "../lib/record-title";
import { useFocusedData } from "../lib/useFocusedData";
import { styles } from "../lib/styles";

/** Every user-visible string on this screen. */
const TEXT = {
  title: "Tell us about yourself",
  /** Why it is worth answering, said once and without a guilt trip. */
  lede: "Leapsake keeps track of who is who around you, so it helps to know where you are in that. Gifts and family connections both start from you.",
  pick: "Which of these is you?",
  /** Over the form, with and without a list above it. */
  addWithList: "Or add yourself",
  addAlone: "Add yourself",
  /** Offered only to a store with nobody in it: a list to pick from. */
  importFirst: "Import your contacts",
  save: "Save",
  saving: "Saving…",
  nameRequired: "Enter a first, middle or last name before saving.",
  failed: "Couldn’t save",
} as const;

/**
 * The one screen that sets the self-person: pick from the people there are,
 * or import some, and either way add yourself by name.
 */
export default function AboutYouScreen() {
  const core = useCore();
  const router = useRouter();
  const load = useCallback(() => core.views.entityList(), [core]);
  const { data: entities, error } = useFocusedData(load);
  const form = usePersonForm();
  const [saving, setSaving] = useState(false);

  /** Set an existing person as you, then dismiss to Home in the tabs below. */
  function pick(person: EntityRow) {
    core.self.set(person.id).then(
      () => router.dismissTo("/"),
      (cause: unknown) => Alert.alert(TEXT.failed, String(cause)),
    );
  }

  /** Create yourself and become the self-person, landing on your page,
   *  where the birthday goes. */
  async function save() {
    const shaped = form.submit();
    if (saving) return;
    if (shaped === null) return showFormProblem(TEXT.nameRequired);
    setSaving(true);
    try {
      const created = await core.people.create(shaped.input, []);
      await core.self.set(created.id);
      router.replace(entityHref("person", created));
    } catch (cause) {
      Alert.alert(TEXT.failed, String(cause));
      setSaving(false);
    }
  }

  if (error !== null) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title: TEXT.title }} />
        <Text style={styles.danger}>{error}</Text>
      </ScrollView>
    );
  }
  if (entities === null) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title: TEXT.title }} />
        <ActivityIndicator />
      </ScrollView>
    );
  }

  // Only a person can be you, so a store of only pets counts as empty.
  const people = entities.filter((entity) => entity.type === "person");

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: TEXT.title }} />
      <Text style={styles.rowText}>{TEXT.lede}</Text>

      {people.length > 0 ? (
        <Typeahead
          label={TEXT.pick}
          value={null}
          options={people}
          onChange={(person) => {
            if (person !== null) pick(person);
          }}
          getKey={(person) => person.id}
          getLabel={(person) => person.label}
          testID="about-you-pick"
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => router.push("/import")}
        >
          <Text style={styles.buttonText}>{TEXT.importFirst}</Text>
        </Pressable>
      )}

      <Text style={styles.sectionTitle}>
        {people.length > 0 ? TEXT.addWithList : TEXT.addAlone}
      </Text>
      <PersonFields
        draft={form.fields}
        onChange={(draft) => form.update(() => draft)}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: saving }}
        style={[styles.button, !form.canSubmit && { opacity: 0.4 }]}
        onPress={() => void save()}
      >
        <Text style={styles.buttonText}>
          {saving ? TEXT.saving : TEXT.save}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
