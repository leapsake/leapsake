import { type Reminder, reminderLabel } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

const TEXT = {
  crumb: "Remove reminder",
  heading: "Remove reminder?",
  confirm: "Remove",
  body: (label: string) => `Remove “${label}”?`,
};

export function ReminderDelete() {
  const reminder = useLoaderData() as Reminder;

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: "Reminders", href: "/reminders" },
        { label: TEXT.crumb },
      ]}
      heading={TEXT.heading}
      confirmLabel={TEXT.confirm}
      cancelTo="/reminders"
      submitting={useSubmitting()}
    >
      {TEXT.body(reminderLabel(reminder))}
    </ConfirmDelete>
  );
}
