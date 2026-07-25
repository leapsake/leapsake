import { type Reminder, reminderLabel } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../components/Breadcrumbs";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { useSubmitting } from "../lib/useSubmitting";

export function ReminderDelete() {
  const reminder = useLoaderData() as Reminder;

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: "Reminders", to: "/reminders" },
        { label: "Remove reminder" },
      ]}
      heading="Remove reminder?"
      confirmLabel="Remove"
      cancelTo="/reminders"
      submitting={useSubmitting()}
    >
      Remove “{reminderLabel(reminder)}”?
    </ConfirmDelete>
  );
}
