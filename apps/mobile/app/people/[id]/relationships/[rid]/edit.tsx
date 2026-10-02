import { useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { relationshipDraftOf } from "@leapsake/schema";
import { RelationshipForm } from "../../../../../components/RelationshipForm";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { LoadState } from "../../../../../components/LoadState";

const TITLE = "Edit relationship";

/** Re-role a relationship from a person's side; core re-derives theirs,
 *  keeping its gendering. */
export default function PersonRelationshipEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, rid } = useLocalSearchParams<{ id: string; rid: string }>();
  const load = useCallback(
    () => core.views.relationshipForSubject("person", id, rid),
    [core, id, rid],
  );
  const { data: view, error } = useFocusedData(load);

  // The form declares the header itself; two `Stack.Screen`s would race.
  if (error !== null || view === null) {
    return <LoadState error={error} header={{ title: TITLE }} />;
  }

  return (
    <RelationshipForm
      title={TITLE}
      subjectType="person"
      canChangeOther={false}
      initialDraft={relationshipDraftOf(view.neighbor)}
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
