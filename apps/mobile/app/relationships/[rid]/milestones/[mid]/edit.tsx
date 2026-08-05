import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../../components/MilestoneForm";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

export default function RelationshipMilestoneEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { rid, mid } = useLocalSearchParams<{ rid: string; mid: string }>();
  // No `core.milestones.get`; load the relationship's own milestones and find
  // this one (keeps `packages/*` untouched — the same list the page renders).
  const load = useCallback(
    async () =>
      (await core.milestones.listForBearer("relationship", rid)) ?? [],
    [core, rid],
  );
  const { data: milestones, error } = useFocusedData(load);
  const milestone = milestones?.find((m) => m.id === mid);

  // The form declares the header (title + Save) itself, so the title is set here
  // only for the branches where it isn't mounted yet. Two `Stack.Screen`s for one
  // route would otherwise race over the same options.
  if (error !== null || milestones === null || milestone === undefined) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit milestone" }} />
        <View style={styles.screen}>
          {error !== null ? (
            <Text style={styles.danger}>{error}</Text>
          ) : milestones === null ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.danger}>Milestone not found.</Text>
          )}
        </View>
      </>
    );
  }

  return (
    <MilestoneForm
      title="Edit milestone"
      bearerType="relationship"
      milestone={milestone}
      onSubmit={async (value) => {
        await core.milestones.update(mid, value);
        router.back();
      }}
    />
  );
}
