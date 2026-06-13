import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { RelationshipForm } from "../../../../../components/RelationshipForm";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

// Edit an explicit relationship from a Pet. Endpoints are immutable, so the
// other end is locked and only its role changes; core re-derives the subject's
// own role (keeping any gender it already had).
export default function PetRelationshipEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, rid } = useLocalSearchParams<{ id: string; rid: string }>();
  const load = useCallback(
    () => core.views.relationshipForSubject("pet", id, rid),
    [core, id, rid],
  );
  const { data: view, error } = useFocusedData(load);

  return (
    <>
      <Stack.Screen options={{ title: "Edit relationship" }} />
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
          lockedOther={{
            type: view.neighbor.otherType,
            id: view.neighbor.otherId,
            label: view.neighbor.otherLabel,
          }}
          initialRole={view.neighbor.otherRole}
          initialNote={view.neighbor.otherRoleNote}
          submitLabel="Save"
          onCancel={() => router.back()}
          onSubmit={async (value) => {
            await core.relationships.editFromSubject({
              subjectType: "pet",
              subjectId: id,
              relId: rid,
              otherRole: value.otherRole,
              otherRoleNote: value.otherRoleNote,
            });
            router.back();
          }}
        />
      )}
    </>
  );
}
