import { useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../../components/MilestoneForm";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { LoadState } from "../../../../../components/LoadState";

export default function PetMilestoneEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, mid } = useLocalSearchParams<{ id: string; mid: string }>();
  // There is no `core.milestones.get`, so find it among the subject's own.
  const load = useCallback(
    async () => (await core.milestones.listForBearer("pet", id)) ?? [],
    [core, id],
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
      bearerType="pet"
      milestone={milestone}
      onSubmit={async (value) => {
        await core.milestones.update(mid, value);
        router.back();
      }}
    />
  );
}
