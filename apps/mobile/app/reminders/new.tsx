import { useRouter } from "expo-router";
import { ReminderForm } from "../../components/ReminderForm";
import { useCore } from "../../lib/core-context";

export default function ReminderCreateScreen() {
  const core = useCore();
  const router = useRouter();

  // The form declares the header (title + Save) itself; nothing loads first here,
  // so it is mounted from the start and this screen never needs its own.
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
