import type { Reminder } from "@leapsake/schema";
import { Breadcrumbs } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { ReminderForm } from "../components/ReminderForm";
import { homeCrumb } from "../lib/crumbs";

export function ReminderEdit() {
  const reminder = useLoaderData() as Reminder;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Reminders", href: "/reminders" },
          { label: "Edit reminder" },
        ]}
      />
      <h1>Edit reminder</h1>
      <ReminderForm reminder={reminder} />
    </main>
  );
}
