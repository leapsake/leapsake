import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  type EntityType,
  type RelationshipRole,
  relationshipDraftOf,
} from "@leapsake/schema";
import { RelationshipForm } from "../../../../components/RelationshipForm";
import { useCore } from "../../../../lib/core-context";
import { relationshipWrites } from "../../../../lib/relationship-writes";
import { useFocusedData } from "../../../../lib/useFocusedData";
import { styles } from "../../../../lib/styles";

const TITLE = "Add relationship";

/**
 * Add a relationship from a person. With `otherType`, `otherId` and `otherRole`
 * it materialises a derived row, the other end fixed.
 */
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
  const writes = relationshipWrites(core, "person", id);

  const candidate =
    view && otherId !== undefined && otherType !== undefined
      ? view.candidates.find((c) => c.type === otherType && c.id === otherId)
      : undefined;

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
      subjectType="person"
      // The picker is beside the point once the other end is settled, and
      // handing it a list it may not use would only invite re-picking.
      candidates={candidate ? undefined : view.candidates}
      canChangeOther={candidate === undefined}
      initialDraft={
        candidate
          ? {
              other: {
                kind: "existing",
                type: candidate.type,
                id: candidate.id,
                label: candidate.label,
              },
              role: otherRole ?? null,
              note: "",
            }
          : relationshipDraftOf()
      }
      commitOther={writes.commitOther}
      onSubmit={async (value) => {
        await writes.save(value);
        router.back();
      }}
    />
  );
}
