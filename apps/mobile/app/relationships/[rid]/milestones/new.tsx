import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../components/MilestoneForm";
import { useCore } from "../../../../lib/core-context";

export default function RelationshipMilestoneNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { rid } = useLocalSearchParams<{ rid: string }>();

  return (
    <>
      <Stack.Screen options={{ title: "Add milestone" }} />
      <MilestoneForm
        subjectType="relationship"
        submitLabel="Add"
        onCancel={() => router.back()}
        onSubmit={async (value) => {
          await core.milestones.create({
            ...value,
            subjectType: "relationship",
            subjectId: rid,
          });
          router.back();
        }}
      />
    </>
  );
}
