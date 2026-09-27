import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { PersonView } from "@leapsake/core";
import { usePersonForm } from "@leapsake/ui/headless";
import { useHeaderSave } from "../../../components/HeaderSave";
import { PersonFields } from "../../../components/PersonFields";
import { tagsRawOf } from "../../../components/TagsInput";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

const TITLE = "Edit details";

const TEXT = {
  saveFailed: "Couldn’t save",
  nameRequired: "Enter a first, middle or last name before saving.",
} as const;

/**
 * A person's own fields — the three parts of their name and their gender — on a
 * screen of their own, behind the **Edit** beside those fields on their page.
 *
 * It is one of several small screens rather than one big one: each thing a user
 * can change about a record gets its own Save, so saving means *this* is
 * written and nothing else is still in the air. See {@link MilestoneForm}, which
 * is the shape every one of them takes.
 */
export default function PersonEditScreen() {
  const core = useCore();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Wrapped, because `views.person` answers `null` for a record that isn't
  // there and `useFocusedData` answers `null` while it is still loading — two
  // different screens to render, and the wrapper is what keeps them apart.
  const load = useCallback(
    async () => ({ view: await core.views.person(id) }),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

  // The form declares the header (title + Save) itself, so the title is set here
  // only for the branches where it isn't mounted yet. Two `Stack.Screen`s for one
  // route would otherwise race over the same options.
  if (error !== null || data === null || data.view === null) {
    return (
      <>
        <Stack.Screen options={{ title: TITLE }} />
        <View style={styles.screen}>
          {error !== null ? (
            <Text style={styles.danger}>{error}</Text>
          ) : data === null ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.danger}>Person not found.</Text>
          )}
        </View>
      </>
    );
  }

  return <PersonEditForm id={id} view={data.view} />;
}

function PersonEditForm({ id, view }: { id: string; view: PersonView }) {
  const core = useCore();
  const router = useRouter();
  // Seeded once, so a reload on focus can't discard what was typed. Gender is the
  // stored one, never the derived `view.gender`; tags ride along since `update` replaces them.
  const form = usePersonForm(view.person, tagsRawOf(view.tags));
  const [saving, setSaving] = useState(false);

  async function save() {
    const shaped = form.submit();
    if (shaped === null || saving) return;
    setSaving(true);
    try {
      await core.people.update(id, shaped.input, shaped.tags);
      router.back();
    } catch (e) {
      Alert.alert(TEXT.saveFailed, String(e));
      setSaving(false);
    }
  }

  const headerRight = useHeaderSave({
    problem: form.errors.name === "required" ? TEXT.nameRequired : undefined,
    saving,
    onPress: () => void save(),
  });
  const options = useMemo(() => ({ title: TITLE, headerRight }), [headerRight]);

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <PersonFields
          draft={form.fields}
          onChange={(draft) => form.update(() => draft)}
        />
      </ScrollView>
    </>
  );
}
