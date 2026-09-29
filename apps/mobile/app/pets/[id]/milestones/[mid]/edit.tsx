import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../../components/MilestoneForm";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

export default function PetMilestoneEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, mid } = useLocalSearchParams<{ id: string; mid: string }>();
  // There is no `core.milestones.get`, so find it among the subject's own.
  const load = useCallback(
    async () => (await core.milestones.listForBearer("pet", id)) ?? [],
    [core, id],
  );
  const { data: milestones, error } = useFocusedData(load);
  const milestone = milestones?.find((m) => m.id === mid);

  // The form declares the header itself; two `Stack.Screen`s would race.
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
      bearerType="pet"
      milestone={milestone}
      onSubmit={async (value) => {
        await core.milestones.update(mid, value);
        router.back();
      }}
    />
  );
}
