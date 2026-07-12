import {
  type ReminderWithTags,
  compareReminderDue,
  formatDueIn,
} from "@leapsake/schema";
import { Link, useFetcher, useLoaderData } from "react-router-dom";
import { ReminderText } from "../components/ReminderText";

/**
 * One reminder row: a done/reopen toggle, the reminder's heading, its edit/remove
 * links, and — when the reminder has both — its body shown underneath as details.
 * The title leads; if there's no title the body *is* the heading, so it isn't
 * repeated below. Inline `#tags` in either field link to their tag pages.
 */
function ReminderRow({ reminder }: { reminder: ReminderWithTags }) {
  const fetcher = useFetcher();
  const done = reminder.completedAt !== null;
  const strike = done ? { textDecoration: "line-through" as const } : undefined;
  const heading = reminder.title ?? reminder.body ?? "";

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
      <span style={strike}>
        <ReminderText
          text={heading}
          tags={reminder.tags}
          mentions={reminder.mentions}
        />
      </span>{" "}
      {reminder.dueDate !== null && (
        <>
          <small style={{ color: "#666" }}>
            {formatDueIn(reminder.dueDate)}
          </small>{" "}
        </>
      )}
      <Link to={`/reminders/${reminder.id}/edit`}>Edit</Link>{" "}
      <Link to={`/reminders/${reminder.id}/delete`}>Remove</Link>
      {reminder.title !== null && reminder.body !== null && (
        <div style={strike}>
          <ReminderText
            text={reminder.body}
            tags={reminder.tags}
            mentions={reminder.mentions}
          />
        </div>
      )}
    </li>
  );
}

/**
 * The Reminders screen — the app's home: a standalone list of user-created
 * reminders. Open reminders lead; completed ones collapse into a details
 * disclosure below.
 */
export function ReminderList() {
  const reminders = useLoaderData() as ReminderWithTags[];
  // Open reminders lead, soonest due first (undated sink below); completed ones
  // keep the repo's newest-first order in the disclosure below.
  const open = reminders
    .filter((r) => r.completedAt === null)
    .sort(compareReminderDue);
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
