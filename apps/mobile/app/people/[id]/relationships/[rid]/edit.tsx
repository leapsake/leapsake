import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { RelationshipForm } from "../../../../../components/RelationshipForm";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

// Edit an explicit relationship from a Person. Endpoints are immutable, so the
// other end is locked and only its role changes; core re-derives the subject's
// own role (keeping any gender it already had).
export default function PersonRelationshipEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, rid } = useLocalSearchParams<{ id: string; rid: string }>();
  const load = useCallback(
    () => core.views.relationshipForSubject("person", id, rid),
    [core, id, rid],
  );
  const { data: view, error } = useFocusedData(load);

  // The form declares the header (title + Save) itself, so the title is set here
  // only for the branches where it isn't mounted yet. Two `Stack.Screen`s for one
  // route would otherwise race over the same options.
  if (error !== null || view === null) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit relationship" }} />
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
    <RelationshipForm
      title="Edit relationship"
      subjectType="person"
      lockedOther={{
        type: view.neighbor.otherType,
        id: view.neighbor.otherId,
        label: view.neighbor.otherLabel,
      }}
      initialRole={view.neighbor.otherRole}
      initialNote={view.neighbor.otherRoleNote}
      onSubmit={async (value) => {
        await core.relationships.editFromSubject({
          subjectType: "person",
          subjectId: id,
          relId: rid,
          otherRole: value.otherRole,
          otherRoleNote: value.otherRoleNote,
        });
        router.back();
      }}
    />
  );
}
