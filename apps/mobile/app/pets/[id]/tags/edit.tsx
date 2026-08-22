import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { TAGS_TITLE, TagsEditForm } from "../../../../components/TagsEditForm";
import { useCore } from "../../../../lib/core-context";
import { useFocusedData } from "../../../../lib/useFocusedData";
import { styles } from "../../../../lib/styles";

/** A pet's tags — see `app/people/[id]/tags/edit.tsx`, which this mirrors. */
export default function PetTagsEditScreen() {
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
        <Stack.Screen options={{ title: TAGS_TITLE }} />
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

  return <TagsEditForm type="pet" id={id} tags={data.view.tags} />;
}
