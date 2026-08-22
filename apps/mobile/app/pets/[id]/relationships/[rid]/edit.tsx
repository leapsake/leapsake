import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { RelationshipForm } from "../../../../../components/RelationshipForm";
import { relationshipDraftFrom } from "../../../../../components/RelationshipFields";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

const TITLE = "Edit relationship";

/**
 * Re-role a stored relationship from a pet's side. Endpoints are immutable,
 * so the other end is fixed and only its role changes; core re-derives the
 * subject's own role, keeping whatever gendering it already had.
 */
export default function PetRelationshipEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, rid } = useLocalSearchParams<{ id: string; rid: string }>();
  const load = useCallback(
    () => core.views.relationshipForSubject("pet", id, rid),
    [core, id, rid],
  );
  const { data: view, error } = useFocusedData(load);

  // The form declares the header (title + Save) itself, so the title is set here
  // only for the branches where it isn't mounted yet. Two `Stack.Screen`s for one
  // route would otherwise race over the same options.
  if (error !== null || view === null) {
    return (
      <>
        <Stack.Screen options={{ title: TITLE }} />
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
      title={TITLE}
      subjectType="pet"
      canChangeOther={false}
      initialDraft={relationshipDraftFrom(view.neighbor)}
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
  );
}
