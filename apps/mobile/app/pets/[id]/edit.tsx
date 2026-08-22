import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { PetView } from "@leapsake/core";
import { parseTagNames } from "@leapsake/schema";
import { useHeaderSave } from "../../../components/HeaderSave";
import {
  PetFields,
  petDraftFrom,
  petDraftToInput,
  petDraftValid,
} from "../../../components/PetFields";
import { tagsRawOf } from "../../../components/TagsInput";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

const TITLE = "Edit details";

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
  const [draft, setDraft] = useState(() =>
    petDraftFrom(view.pet, tagsRawOf(view.tags)),
  );
  const [saving, setSaving] = useState(false);

  const canSave = !saving && petDraftValid(draft);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await core.pets.update(
        id,
        petDraftToInput(draft),
        parseTagNames(draft.tags),
      );
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save", String(e));
      setSaving(false);
    }
  }

  const headerRight = useHeaderSave({
    canSave,
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
        <PetFields draft={draft} onChange={setDraft} />
      </ScrollView>
    </>
  );
}
