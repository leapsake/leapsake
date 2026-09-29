import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { TAGS_TITLE, TagsEditForm } from "../../../../components/TagsEditForm";
import { useCore } from "../../../../lib/core-context";
import { useFocusedData } from "../../../../lib/useFocusedData";
import { styles } from "../../../../lib/styles";

/** A person's tags, through {@link TagsEditForm}. */
export default function PersonTagsEditScreen() {
  const core = useCore();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Wrapped so "not there" and "not loaded yet" stay distinguishable — see
  // `app/people/[id]/edit.tsx`.
  const load = useCallback(
    async () => ({ view: await core.views.person(id) }),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

  // The form declares the header itself; two `Stack.Screen`s would race.
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
            <Text style={styles.danger}>Person not found.</Text>
          )}
        </View>
      </>
    );
  }

  return <TagsEditForm type="person" id={id} tags={data.view.tags} />;
}
