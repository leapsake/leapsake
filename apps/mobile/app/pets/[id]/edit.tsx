import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { PetView } from "@leapsake/core";
import { usePetForm } from "@leapsake/ui/headless";
import { useHeaderSave } from "../../../components/HeaderSave";
import { PetFields } from "../../../components/PetFields";
import { tagsRawOf } from "../../../components/TagsInput";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

const TITLE = "Edit details";

const TEXT = {
  saveFailed: "Couldn’t save",
  nameRequired: "Enter the pet’s name before saving.",
} as const;

/** A pet's name and gender — see `app/people/[id]/edit.tsx`, which this mirrors. */
export default function PetEditScreen() {
  const core = useCore();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(
    async () => ({ view: await core.views.pet(id) }),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

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
            <Text style={styles.danger}>Pet not found.</Text>
          )}
        </View>
      </>
    );
  }

  return <PetEditForm id={id} view={data.view} />;
}

function PetEditForm({ id, view }: { id: string; view: PetView }) {
  const core = useCore();
  const router = useRouter();
  // Seeded once, tags and all — see the person screen for both reasons.
  const form = usePetForm(view.pet, tagsRawOf(view.tags));
  const [saving, setSaving] = useState(false);

  async function save() {
    const shaped = form.submit();
    if (shaped === null || saving) return;
    setSaving(true);
    try {
      await core.pets.update(id, shaped.input, shaped.tags);
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
        <PetFields
          draft={form.fields}
          onChange={(draft) => form.update(() => draft)}
        />
      </ScrollView>
    </>
  );
}
