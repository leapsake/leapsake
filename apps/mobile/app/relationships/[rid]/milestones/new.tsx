import { useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../components/MilestoneForm";
import { useCore } from "../../../../lib/core-context";

export default function RelationshipMilestoneNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { rid } = useLocalSearchParams<{ rid: string }>();

  // The form declares the header (title + Save) itself; nothing loads first here,
  // so it is mounted from the start and this screen never needs its own.
  return (
    <MilestoneForm
      title="Add milestone"
      bearerType="relationship"
      onSubmit={async (value) => {
        await core.milestones.create({
          ...value,
          bearerType: "relationship",
          bearerId: rid,
        });
        router.back();
      }}
    />
  );
}
