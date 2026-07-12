import { type Reminder, reminderLabel } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

export function ReminderDelete() {
  const reminder = useLoaderData() as Reminder;
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Reminders", to: "/reminders" },
          { label: "Remove reminder" },
        ]}
      />
      <h1>Remove reminder?</h1>
      <p>Remove “{reminderLabel(reminder)}”?</p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Remove</button>{" "}
          <Link to="/reminders">Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
