import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { EntityType, RelationshipRole } from "@leapsake/schema";
import { RelationshipForm } from "../../../../components/RelationshipForm";
import { useCore } from "../../../../lib/core-context";
import { useFocusedData } from "../../../../lib/useFocusedData";
import { styles } from "../../../../lib/styles";

// Add a relationship from a Pet. With no query params the candidate picker is
// shown (fresh add); with otherType/otherId/otherRole the other end is locked —
// the materialise path for a derived edge, which creates a stored edge here.
export default function PetRelationshipNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, otherType, otherId, otherRole } = useLocalSearchParams<{
    id: string;
    otherType?: EntityType;
    otherId?: string;
    otherRole?: RelationshipRole;
  }>();
  const load = useCallback(
    () => core.views.relationshipNew("pet", id),
    [core, id],
  );
  const { data: view, error } = useFocusedData(load);

  const candidate =
    view && otherId !== undefined && otherType !== undefined
      ? view.candidates.find((c) => c.type === otherType && c.id === otherId)
      : undefined;

  return (
    <>
      <Stack.Screen options={{ title: "Add relationship" }} />
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : view === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : (
        <RelationshipForm
          subjectType="pet"
          candidates={view.candidates}
          lockedOther={
            candidate
              ? {
                  type: candidate.type,
                  id: candidate.id,
                  label: candidate.label,
                }
              : undefined
          }
          initialRole={candidate ? otherRole : undefined}
          submitLabel="Add"
          onCancel={() => router.back()}
          onSubmit={async (value) => {
            await core.relationships.createFromSubject({
              subjectType: "pet",
              subjectId: id,
              ...value,
            });
            router.back();
          }}
        />
      )}
    </>
  );
}
