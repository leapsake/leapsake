import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { EntityType, RelationshipRole } from "@leapsake/schema";
import { RelationshipForm } from "../../../../components/RelationshipForm";
import { emptyRelationshipDraft } from "../../../../components/RelationshipFields";
import { useCore } from "../../../../lib/core-context";
import { useFocusedData } from "../../../../lib/useFocusedData";
import { styles } from "../../../../lib/styles";

const TITLE = "Add relationship";

/**
 * Add a relationship from a person.
 *
 * With no query params this is the ordinary add: pick anyone in the list, or
 * type a name past the end of it and get an unpublished entity created
 * alongside the edge. With `otherType` / `otherId` / `otherRole` it is the
 * **materialise** path — the Edit on a derived row, opening on the inference
 * with the other end fixed, where saving writes the edge that was only being
 * computed.
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
          : emptyRelationshipDraft()
      }
      // Edit on somebody new writes them with this relationship at once, so
      // Save then revises that relationship rather than adding a second.
      commitOther={async (party, otherRole, otherRoleNote) => {
        const { other, relationship } =
          await core.relationships.createWithNewOther({
            subjectType: "person",
            subjectId: id,
            otherType: party.type,
            otherName: party.name,
            otherRole,
            otherRoleNote,
          });
        return { id: other.id, relationshipId: relationship.id };
      }}
      onSubmit={async (value) => {
        if (value.other === "existing" && value.relationshipId !== undefined)
          await core.relationships.editFromSubject({
            subjectType: "person",
            subjectId: id,
            relId: value.relationshipId,
            otherRole: value.otherRole,
            otherRoleNote: value.otherRoleNote,
          });
        else
          // Two calls, because the other end is either somebody already in the
          // list or somebody being named for the first time — the second creates
          // them as a fact about this person and nothing more.
          await (value.other === "existing"
            ? core.relationships.createFromSubject({
                subjectType: "person",
                subjectId: id,
                ...value,
              })
            : core.relationships.createWithNewOther({
                subjectType: "person",
                subjectId: id,
                ...value,
              }));
        router.back();
      }}
    />
  );
}
