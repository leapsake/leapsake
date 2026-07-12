import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../../components/MilestoneForm";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

export default function PersonMilestoneEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, mid } = useLocalSearchParams<{ id: string; mid: string }>();
  // No `core.milestones.get`; load the subject's own milestones and find this one
  // (keeps `packages/*` untouched — the same list the timeline is built from).
  const load = useCallback(
    async () => (await core.milestones.listForBearer("person", id)) ?? [],
    [core, id],
  );
  const { data: milestones, error } = useFocusedData(load);
  const milestone = milestones?.find((m) => m.id === mid);

  return (
    <>
      <Stack.Screen options={{ title: "Edit milestone" }} />
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : milestones === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : milestone === undefined ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>Milestone not found.</Text>
        </View>
      ) : (
        <MilestoneForm
          bearerType="person"
          milestone={milestone}
          submitLabel="Save"
          onCancel={() => router.back()}
          onSubmit={async (value) => {
            await core.milestones.update(mid, value);
            router.back();
          }}
        />
      )}
    </>
  );
}
