import { type Reminder, reminderLabel } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

export function ReminderDelete() {
  const reminder = useLoaderData() as Reminder;

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: "Reminders", href: "/reminders" },
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
