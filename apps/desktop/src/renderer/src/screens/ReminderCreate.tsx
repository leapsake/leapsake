import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { ReminderForm } from "../components/ReminderForm";

export function ReminderCreate() {
  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Reminders", to: "/reminders" },
          { label: "Add reminder" },
        ]}
      />
      <h1>Add reminder</h1>
      <ReminderForm />
    </main>
  );
}
