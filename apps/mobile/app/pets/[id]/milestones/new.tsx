import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../components/MilestoneForm";
import { useCore } from "../../../../lib/core-context";

export default function PetMilestoneNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen options={{ title: "Add milestone" }} />
      <MilestoneForm
        subjectType="pet"
        submitLabel="Add"
        onCancel={() => router.back()}
        onSubmit={async (value) => {
          await core.milestones.create({
            ...value,
            subjectType: "pet",
            subjectId: id,
          });
          router.back();
        }}
      />
    </>
  );
}
