import type { GiftReminderTarget, OnboardingRoute } from "@leapsake/core";
import {
  type ReminderWithTags,
  formatDueIn,
  isReminderEditable,
} from "@leapsake/schema";
import { ReminderText } from "@leapsake/ui/web";
import {
  type ReminderCta,
  partitionReminders,
  reminderCtaOf,
} from "@leapsake/view-models";
import { Link, useFetcher, useLoaderData } from "react-router-dom";

/** Each onboarding nudge's abstract {@link OnboardingRoute} as this client's own
 *  router path plus its link copy. */
const ONBOARDING_CTA: Record<OnboardingRoute, { path: string; label: string }> =
  {
    "add-person": { path: "/people/new", label: "Add person →" },
    "connect-sync": { path: "/settings", label: "Set up sync →" },
    "pick-self": { path: "/people?pick=self", label: "Pick yourself →" },
  };

/**
 * A reminder's CTA decision (see {@link reminderCtaOf}, which holds the *why* of
 * each) rendered in this client's terms: a react-router path plus its copy. A
 * gift CTA's target flips once the reminder is done — from the recipient's own
 * page to the capture form fixed to them, to log what was actually given.
 */
function ctaLinkFor(cta: ReminderCta): { path: string; label: string } {
  switch (cta.kind) {
    case "onboarding":
      return ONBOARDING_CTA[cta.route];
    case "duplicates":
      return { path: "/duplicates", label: "Review duplicates →" };
    case "gift": {
      const party = `${cta.recipientType}:${cta.recipientId}`;
      return cta.action === "record-giving"
        ? {
            path: `/gifts/new?recipient=${encodeURIComponent(party)}`,
            label: "Record what you gave →",
          }
        : {
            path: `${cta.recipientType === "pet" ? "/pets" : "/people"}/${cta.recipientId}`,
            label: "See their gifts →",
          };
    }
  }
}

/**
 * One reminder row: a done/reopen toggle, the reminder's heading, its edit/remove
 * links, and — when the reminder has both — its body shown underneath as details.
 * The title leads; if there's no title the body *is* the heading, so it isn't
 * repeated below. Inline `#tags` in either field link to their tag pages.
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
  const fetcher = useFetcher();
  const done = reminder.completedAt !== null;
  const strike = done ? { textDecoration: "line-through" as const } : undefined;
  const heading = reminder.title ?? reminder.body ?? "";
  // Nudges and gift reminders deep-link somewhere; an ordinary reminder
  // (milestone / birthday / user) has nowhere to go and shows no CTA.
  const decision = reminderCtaOf(reminder, { giftTarget, isDuplicatesNudge });
  const cta = decision === null ? null : ctaLinkFor(decision);

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
