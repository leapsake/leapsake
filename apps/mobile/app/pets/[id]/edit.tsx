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

  // The form declares the header (title + Save) itself, so the title is set here
  // only for the branches where it isn't mounted yet. Two `Stack.Screen`s for one
  // route would otherwise race over the same options.
  if (error !== null || view === null) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit pet" }} />
        <View style={styles.screen}>
          {error !== null ? (
            <Text style={styles.danger}>{error}</Text>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      </>
    );
  }

  return (
    <PetForm
      title="Edit pet"
      pet={view.pet}
      // Same round-trip as desktop: labels in, parseTagNames out.
      tagNames={view.tags.map((tag) => tagLabel(tag.name)).join(" ")}
      onSubmit={async (input, tagsRaw) => {
        await core.pets.update(id, input, parseTagNames(tagsRaw));
        router.back();
      }}
    />
  );
}
