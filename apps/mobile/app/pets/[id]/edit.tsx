import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { parseTagNames, tagLabel } from "@leapsake/schema";
import { PetForm } from "../../../components/PetForm";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

export default function PetEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => core.views.pet(id), [core, id]);
  const { data: view, error } = useFocusedData(load);

  return (
    <>
      <Stack.Screen options={{ title: "Edit pet" }} />
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : view === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : (
        <PetForm
          pet={view.pet}
          // Same round-trip as desktop: labels in, parseTagNames out.
          tagNames={view.tags.map((tag) => tagLabel(tag.name)).join(" ")}
          submitLabel="Save"
          onCancel={() => router.back()}
          onSubmit={async (input, tagsRaw) => {
            await core.pets.update(id, input, parseTagNames(tagsRaw));
            router.back();
          }}
        />
      )}
    </>
  );
}
