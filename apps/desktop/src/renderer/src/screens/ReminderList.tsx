import type { GiftReminderTarget } from "@leapsake/core";
import {
  type ReminderWithTags,
  formatDueIn,
  isReminderEditable,
} from "@leapsake/schema";
import { ReminderText } from "@leapsake/ui/web";
import { partitionReminders, reminderActionsOf } from "@leapsake/view-models";
import { Fragment } from "react";
import { Link, useFetcher, useLoaderData } from "react-router-dom";
import { rowAffordanceFor, showsRemove } from "../lib/reminder-row";

/**
 * One reminder row: a done/reopen toggle, the reminder's heading, whatever the
 * row offers (do it · not now · don't ask again), its edit/remove links, and —
 * when the reminder has both — its body shown underneath as details. The title
 * leads; if there's no title the body *is* the heading, so it isn't repeated
 * below. Inline `#tags` in either field link to their tag pages.
 */
function ReminderRow({
  reminder,
  giftTarget,
  isDuplicatesNudge = false,
}: {
  reminder: ReminderWithTags;
  /** Set when this is a `🎁 gift` reminder — see {@link giftCtaFor}. */
  giftTarget?: GiftReminderTarget;
  /** Set when this row is the duplicates nudge, whose CTA opens the review. */
  isDuplicatesNudge?: boolean;
}) {
  // Two fetchers, not one: completing and putting off are separate submissions
  // and shouldn't share a pending state.
  const completeFetcher = useFetcher();
  const snoozeFetcher = useFetcher();
  const done = reminder.completedAt !== null;
  const strike = done ? { textDecoration: "line-through" as const } : undefined;
  const heading = reminder.title ?? reminder.body ?? "";
  // Everything this row offers, in offer order — the view-model is the only
  // authority on *what* is offered; this screen owns only how it looks. An
  // ordinary reminder (milestone / birthday / user) offers nothing.
  const actions = reminderActionsOf(reminder, {
    giftTarget,
    isDuplicatesNudge,
  });

  return (
    <li>
      <completeFetcher.Form
        method="post"
        action={`/reminders/${reminder.id}/complete`}
        style={{ display: "inline" }}
      >
        <input type="hidden" name="completed" value={done ? "false" : "true"} />
        <button type="submit">{done ? "Reopen" : "Done"}</button>
      </completeFetcher.Form>{" "}
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
          their text — so only user reminders get an Edit link. Done/Reopen stays
          available on every reminder; Remove doesn't (see `showsRemove`). */}
      {isReminderEditable(reminder) && (
        <>
          <Link to={`/reminders/${reminder.id}/edit`}>Edit</Link>{" "}
        </>
      )}
      {actions.map((action) => {
        const affordance = rowAffordanceFor(action, reminder.id);
        // Each kind is offered at most once per row, so it keys them.
        return (
          <Fragment key={action.kind}>
            {affordance.kind === "snooze" ? (
              // A post, not a link: the row has to leave the list once it's put
              // off, and a fetcher submission revalidates this screen's loader
              // in place. The date is the one the offered action carried.
              <snoozeFetcher.Form
                method="post"
                action={affordance.to}
                style={{ display: "inline" }}
              >
                <input type="hidden" name="until" value={affordance.until} />
                <button type="submit">{affordance.label}</button>
              </snoozeFetcher.Form>
            ) : (
              <Link to={affordance.to}>{affordance.label}</Link>
            )}{" "}
          </Fragment>
        );
      })}
      {showsRemove(actions, done) && (
        <Link to={`/reminders/${reminder.id}/delete`}>Remove</Link>
      )}
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
  const { reminders, giftTargets, duplicatesNudgeId } = useLoaderData() as {
    reminders: ReminderWithTags[];
    giftTargets: GiftReminderTarget[];
    /** The id of today's duplicates nudge, or null when there are no pairs. */
    duplicatesNudgeId: string | null;
  };
  const giftTargetById = new Map(giftTargets.map((t) => [t.reminderId, t]));
  // Open reminders lead; completed ones collapse into the disclosure below.
  const { open, done } = partitionReminders(reminders);

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
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              giftTarget={giftTargetById.get(reminder.id)}
              isDuplicatesNudge={reminder.id === duplicatesNudgeId}
            />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details>
          <summary>Completed ({done.length})</summary>
          <ul>
            {done.map((reminder) => (
              <ReminderRow
                key={reminder.id}
                reminder={reminder}
                giftTarget={giftTargetById.get(reminder.id)}
              />
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
