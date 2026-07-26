import type { Reminder } from "@leapsake/schema";
import { Breadcrumbs, ReminderForm } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { searchEntities } from "../lib/search";
import { useSubmitting } from "../lib/useSubmitting";

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
      <ReminderForm
        reminder={reminder}
        search={searchEntities}
        submitting={useSubmitting()}
      />
    </main>
  );
}
