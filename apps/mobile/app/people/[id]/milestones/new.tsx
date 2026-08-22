import { useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../components/MilestoneForm";
import { useCore } from "../../../../lib/core-context";

export default function PersonMilestoneNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // The form declares the header (title + Save) itself; nothing loads first here,
  // so it is mounted from the start and this screen never needs its own.
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
