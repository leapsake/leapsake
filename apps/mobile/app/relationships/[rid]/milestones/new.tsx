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
        bearerType="relationship"
        submitLabel="Add"
        onCancel={() => router.back()}
        onSubmit={async (value) => {
          await core.milestones.create({
            ...value,
            bearerType: "relationship",
            bearerId: rid,
          });
          router.back();
        }}
      />
    </>
  );
}
