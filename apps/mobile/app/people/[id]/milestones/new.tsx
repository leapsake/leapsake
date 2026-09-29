import { useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../components/MilestoneForm";
import { useCore } from "../../../../lib/core-context";

export default function PersonMilestoneNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Nothing loads first, so the form declares the header from the start.
  return (
    <MilestoneForm
      title="Add milestone"
      bearerType="person"
      onSubmit={async (value) => {
        await core.milestones.create({
          ...value,
          bearerType: "person",
          bearerId: id,
        });
        router.back();
      }}
    />
  );
}
