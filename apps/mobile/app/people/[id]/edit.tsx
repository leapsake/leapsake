import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { parseTagNames, tagLabel } from "@leapsake/schema";
import { PersonForm } from "../../../components/PersonForm";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

export default function PersonEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => core.views.person(id), [core, id]);
  const { data: view, error } = useFocusedData(load);

  return (
    <>
      <Stack.Screen options={{ title: "Edit person" }} />
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : view === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : (
        <PersonForm
          person={view.person}
          // Same round-trip as desktop: labels in, parseTagNames out.
          tagNames={view.tags.map((tag) => tagLabel(tag.name)).join(" ")}
          submitLabel="Save"
          onCancel={() => router.back()}
          onSubmit={async (input, tagsRaw) => {
            await core.people.update(id, input, parseTagNames(tagsRaw));
            router.back();
          }}
        />
      )}
    </>
  );
}
