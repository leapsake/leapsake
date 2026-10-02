import { useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../../components/MilestoneForm";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { LoadState } from "../../../../../components/LoadState";

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

  // The form declares the header itself; two `Stack.Screen`s would race.
  if (error !== null || milestones === null || milestone === undefined) {
    return (
      <LoadState
        error={error}
        loading={milestones === null}
        missing="Milestone not found."
        header={{ title: "Edit milestone" }}
      />
    );
  }

  return (
    <MilestoneForm
      title="Edit milestone"
      bearerType="relationship"
      milestone={milestone}
      onSubmit={async (value) => {
        await core.milestones.update(mid, value);
        router.back();
      }}
    />
  );
}
