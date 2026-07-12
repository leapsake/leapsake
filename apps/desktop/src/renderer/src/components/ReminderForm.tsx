import { type Reminder, isoFromDueMs } from "@leapsake/schema";
import { Form, Link, useNavigation } from "react-router-dom";

/**
 * The shared create/edit form for a Reminder. Title and body are both optional
 * free text (the action drops empty fields to null; core requires at least one).
 * `#tags` are typed **inline** in either field — there is no separate tags input
 * — and are parsed out and applied on save, so the text stays the source of
 * truth. Presentational: the route action owns the write.
 */
export function ReminderForm({ reminder }: { reminder?: Reminder }) {
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  return (
    <Form method="post">
      <fieldset disabled={saving}>
        <p>
          <label>
            Title
            <br />
            <input
              type="text"
              name="title"
              defaultValue={reminder?.title ?? ""}
              placeholder="Call mom"
            />
          </label>
        </p>
        <p>
          <label>
            Details
            <br />
            <textarea
              name="body"
              rows={4}
              defaultValue={reminder?.body ?? ""}
              placeholder="Add #tags inline, e.g. ask about the trip #family"
            />
          </label>
        </p>
        <p>
          <label>
            Due date
            <br />
            <input
              type="date"
              name="dueDate"
              defaultValue={
                reminder?.dueDate != null ? isoFromDueMs(reminder.dueDate) : ""
              }
            />
          </label>
        </p>
        <p>
          <button type="submit">Save</button>{" "}
          <Link to="/reminders">Cancel</Link>
        </p>
      </fieldset>
    </Form>
  );
}
