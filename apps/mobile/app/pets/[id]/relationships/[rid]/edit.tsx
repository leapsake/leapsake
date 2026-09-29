import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { relationshipDraftOf } from "@leapsake/schema";
import { RelationshipForm } from "../../../../../components/RelationshipForm";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

const TITLE = "Edit relationship";

/** Re-role a relationship from a pet's side; core re-derives the pet's,
 *  keeping its gendering. */
export default function PetRelationshipEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, rid } = useLocalSearchParams<{ id: string; rid: string }>();
  const load = useCallback(
    () => core.views.relationshipForSubject("pet", id, rid),
    [core, id, rid],
  );
  const { data: view, error } = useFocusedData(load);

  // The form declares the header itself; two `Stack.Screen`s would race.
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
      initialDraft={relationshipDraftOf(view.neighbor)}
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
