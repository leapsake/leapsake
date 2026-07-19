import { type OnboardingRoute, onboardingRouteOf } from "@leapsake/core";
import {
  type ReminderWithTags,
  compareReminderDue,
  formatDueIn,
  isReminderEditable,
} from "@leapsake/schema";
import { Link, useFetcher, useLoaderData } from "react-router-dom";
import { ReminderText } from "../components/ReminderText";

/**
 * The deep-link CTA each onboarding nudge (a `system` reminder whose id maps to an
 * {@link OnboardingRoute}) renders — the abstract route mapped to this client's own
 * router path plus its button copy. Looked up by id via {@link onboardingRouteOf};
 * a non-onboarding reminder returns null and shows no CTA.
 */
const ONBOARDING_CTA: Record<OnboardingRoute, { path: string; label: string }> =
  {
    "add-person": { path: "/people/new", label: "Add person →" },
    "connect-sync": { path: "/settings", label: "Set up sync →" },
  };

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
  // Onboarding nudges deep-link to their target screen; a non-onboarding reminder
  // (milestone / user) has no route and shows no CTA.
  const onboardingRoute = onboardingRouteOf(reminder.id);
  const cta = onboardingRoute === null ? null : ONBOARDING_CTA[onboardingRoute];

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
      {/* Automatic (birthday) reminders aren't content-editable — the engine owns
          their text — so only user reminders get an Edit link. Done/Reopen and
          Remove stay available on every reminder. */}
      {isReminderEditable(reminder) && (
        <>
          <Link to={`/reminders/${reminder.id}/edit`}>Edit</Link>{" "}
        </>
      )}
      {cta !== null && (
        <>
          <Link to={cta.path}>{cta.label}</Link>{" "}
        </>
      )}
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
