import type { Reminder } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { ReminderForm } from "../components/ReminderForm";

export function ReminderEdit() {
  const reminder = useLoaderData() as Reminder;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Reminders", to: "/reminders" },
          { label: "Edit reminder" },
        ]}
      />
      <h1>Edit reminder</h1>
      <ReminderForm reminder={reminder} />
    </main>
  );
}
