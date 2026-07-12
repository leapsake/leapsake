import { Stack, useRouter } from "expo-router";
import { ReminderForm } from "../../components/ReminderForm";
import { useCore } from "../../lib/core-context";

export default function ReminderCreateScreen() {
  const core = useCore();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: "Add reminder" }} />
      <ReminderForm
        submitLabel="Add"
        onCancel={() => router.back()}
        onSubmit={async (input) => {
          await core.reminders.create(input);
          // Back to the Reminders tab, which reloads its list on focus.
          router.back();
        }}
      />
    </>
  );
}
