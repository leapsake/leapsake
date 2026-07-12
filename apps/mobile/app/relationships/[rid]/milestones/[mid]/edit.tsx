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
          bearerType="relationship"
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
