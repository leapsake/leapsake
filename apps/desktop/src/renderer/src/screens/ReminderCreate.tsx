import { Breadcrumbs, ReminderForm } from "@leapsake/ui/web";
import { homeCrumb } from "../lib/crumbs";
import { searchEntities } from "../lib/search";
import { useSubmitting } from "../lib/useSubmitting";

export function ReminderCreate() {
  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Reminders", href: "/reminders" },
          { label: "Add reminder" },
        ]}
      />
      <h1>Add reminder</h1>
      <ReminderForm search={searchEntities} submitting={useSubmitting()} />
    </main>
  );
}
