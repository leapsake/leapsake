import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { EntityType, RelationshipRole } from "@leapsake/schema";
import { RelationshipForm } from "../../../../components/RelationshipForm";
import { useCore } from "../../../../lib/core-context";
import { useFocusedData } from "../../../../lib/useFocusedData";
import { styles } from "../../../../lib/styles";

// Add a relationship from a Person. With no query params the candidate picker is
// shown (fresh add); with otherType/otherId/otherRole the other end is locked —
// the materialise path for a derived edge, which creates a stored edge here.
export default function PersonRelationshipNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, otherType, otherId, otherRole } = useLocalSearchParams<{
    id: string;
    otherType?: EntityType;
    otherId?: string;
    otherRole?: RelationshipRole;
  }>();
  const load = useCallback(
    () => core.views.relationshipNew("person", id),
    [core, id],
  );
  const { data: view, error } = useFocusedData(load);

  const candidate =
    view && otherId !== undefined && otherType !== undefined
      ? view.candidates.find((c) => c.type === otherType && c.id === otherId)
      : undefined;

  // The form declares the header (title + Save) itself, so the title is set here
  // only for the branches where it isn't mounted yet. Two `Stack.Screen`s for one
  // route would otherwise race over the same options.
  if (error !== null || view === null) {
    return (
      <>
        <Stack.Screen options={{ title: "Add relationship" }} />
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
      title="Add relationship"
      subjectType="person"
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
      onSubmit={async (value) => {
        await core.relationships.createFromSubject({
          subjectType: "person",
          subjectId: id,
          ...value,
        });
        router.back();
      }}
    />
  );
}
