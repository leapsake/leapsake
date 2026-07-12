import { type Reminder, reminderLabel } from "@leapsake/schema";
import { Link, useFetcher, useLoaderData } from "react-router-dom";

/** One reminder row: a done/reopen toggle plus its label and edit/remove links. */
function ReminderRow({ reminder }: { reminder: Reminder }) {
  const fetcher = useFetcher();
  const done = reminder.completedAt !== null;

  return (
    <li>
      <fetcher.Form
        method="post"
        action={`/reminders/${reminder.id}/complete`}
        style={{ display: "inline" }}
      >
        <input type="hidden" name="completed" value={done ? "false" : "true"} />
        <button type="submit">{done ? "Reopen" : "Done"}</button>
      </fetcher.Form>{" "}
      <span style={{ textDecoration: done ? "line-through" : undefined }}>
        {reminderLabel(reminder)}
      </span>{" "}
      <Link to={`/reminders/${reminder.id}/edit`}>Edit</Link>{" "}
      <Link to={`/reminders/${reminder.id}/delete`}>Remove</Link>
    </li>
  );
}

/**
 * The Reminders screen — a standalone list of user-created reminders (the seed of
 * the future home screen). Open reminders lead; completed ones collapse into a
 * details disclosure below.
 */
export function ReminderList() {
  const reminders = useLoaderData() as Reminder[];
  const open = reminders.filter((r) => r.completedAt === null);
  const done = reminders.filter((r) => r.completedAt !== null);

  return (
    <main>
      <h1>Reminders</h1>

      <p>
        <Link to="/reminders/new">Add reminder</Link>
      </p>

      {open.length === 0 ? (
        <p>No open reminders.</p>
      ) : (
        <ul>
          {open.map((reminder) => (
            <ReminderRow key={reminder.id} reminder={reminder} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details>
          <summary>Completed ({done.length})</summary>
          <ul>
            {done.map((reminder) => (
              <ReminderRow key={reminder.id} reminder={reminder} />
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
