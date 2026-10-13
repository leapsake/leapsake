import { type MilestoneKind, isMilestoneKind } from "@leapsake/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../components/MilestoneForm";
import { useCore } from "../../../../lib/core-context";

export default function PetMilestoneNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  // `?kind=`, from "They’ve passed away", opens on that kind.
  const initialKind: MilestoneKind | undefined = isMilestoneKind(kind)
    ? kind
    : undefined;

  // Nothing loads first, so the form declares the header from the start.
  return (
    <MilestoneForm
      title="Add milestone"
      bearerType="pet"
      bearerId={id}
      initialKind={initialKind}
      onSubmit={async (value) => {
        await core.milestones.create({
          ...value,
          bearerType: "pet",
          bearerId: id,
        });
        router.back();
      }}
    />
  );
}
