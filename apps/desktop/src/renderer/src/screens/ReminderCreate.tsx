import { Breadcrumbs } from "@leapsake/ui/web";
import { ReminderForm } from "../components/ReminderForm";
import { homeCrumb } from "../lib/crumbs";

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
      <ReminderForm />
    </main>
  );
}
