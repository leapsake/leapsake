import { type Reminder, isoFromDueMs } from "@leapsake/schema";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router-dom";
import { MentionTextField } from "./MentionTextField";

/**
 * The shared create/edit form for a Reminder. Title and body are both optional
 * free text (the action drops empty fields to null; core requires at least one).
 * `#tags` and `@mentions` are typed **inline** in either field — there is no
 * separate input for either — and are parsed out and applied on save, so the text
 * stays the source of truth. Title and Details are controlled (React state) so the
 * `@mention` picker can splice tokens in, but keep their `name` attributes so the
 * route action reads them from `FormData` exactly as before. Presentational: the
 * route action owns the write.
 */
export function ReminderForm({ reminder }: { reminder?: Reminder }) {
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [title, setTitle] = useState(reminder?.title ?? "");
  const [body, setBody] = useState(reminder?.body ?? "");

  return (
    <Form method="post">
      <fieldset disabled={saving}>
        <p>
          <label htmlFor="reminder-title">Title</label>
          <br />
          <MentionTextField
            id="reminder-title"
            name="title"
            value={title}
            onChange={setTitle}
            placeholder="Call mom"
          />
        </p>
        <p>
          <label htmlFor="reminder-body">Details</label>
          <br />
          <MentionTextField
            id="reminder-body"
            name="body"
            value={body}
            onChange={setBody}
            multiline
            rows={4}
            placeholder="Type @ to mention someone; add #tags inline, e.g. ask about the trip #family"
          />
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
