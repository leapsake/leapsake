import { useRouter } from "expo-router";
import { ReminderForm } from "../../components/ReminderForm";
import { useCore } from "../../lib/core-context";

export default function ReminderCreateScreen() {
  const core = useCore();
  const router = useRouter();

  // Nothing loads first, so the form declares the header from the start.
  return (
    <ReminderForm
      title="Add reminder"
      onSubmit={async (input) => {
        await core.reminders.create(input);
        // Back to the Reminders tab, which reloads its list on focus.
        router.back();
      }}
    />
  );
}
