import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../components/MilestoneForm";
import { useCore } from "../../../../lib/core-context";

export default function PersonMilestoneNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen options={{ title: "Add milestone" }} />
      <MilestoneForm
        bearerType="person"
        submitLabel="Add"
        onCancel={() => router.back()}
        onSubmit={async (value) => {
          await core.milestones.create({
            ...value,
            bearerType: "person",
            bearerId: id,
          });
          router.back();
        }}
      />
    </>
  );
}
