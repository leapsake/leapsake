import type {
  ContactReminderTarget,
  GiftReminderTarget,
  PlanReminderTarget,
  ReminderInWindow,
  SystemReminderTargets,
} from "@leapsake/core";
import { formatDueIn, isReminderEditable } from "@leapsake/schema";
import { ReminderText } from "@leapsake/ui/web";
import {
  bucketReminders,
  groupComingByActivation,
  reminderActionsOf,
} from "@leapsake/view-models";
import { Fragment } from "react";
import { Link, useFetcher, useLoaderData } from "react-router-dom";
import { rowAffordanceFor, showsRemove } from "../lib/reminder-row";

/**
 * Every user-visible string on this screen, in one place so the later
 * message-catalog sweep is mechanical (AGENTS.md → *User-visible text*). None
 * of them takes a value; the counts are rendered beside them rather than
 * interpolated in, so no sentence is built out of fragments here.
 */
const TEXT = {
  title: "Reminders",
  add: "Add reminder",
  pastDue: "Past due",
  belated: "Belated",
  today: "Today",
  available: "Available",
  coming: "Coming",
  completed: "Completed",
  /** Nothing owed, but something is still there to do if you want to. */
  noneOwed: "Nothing owed today.",
  /** Nothing owed and nothing available either. */
  allClear: "Nothing to do. You’re all caught up.",
  /** No reminders at all — a first run, not a finished day. */
  empty: "No reminders yet.",
} as const;

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
  planTarget,
  contactTarget,
  isDuplicatesNudge = false,
}: {
  reminder: ReminderInWindow;
  /** Set when this is a `🎁 gift` reminder — see {@link giftCtaFor}. */
  giftTarget?: GiftReminderTarget;
  /** Set when this is a `🗓 plan` prompt — what it asks about, and its offers. */
  planTarget?: PlanReminderTarget;
  /**
   * Set when this is a `🎉 wish` about a person. It becomes a CTA only where
   * they have **no** way to be reached; where they do, this client shows nothing
   * — ⚠️ deliberately, and not an omission. `@leapsake/ui`'s
   * `ContactMethodsSection` already decided that a contact row here is not a tap
   * target: the actions in `@leapsake/contact-links` are built for a handset with
   * the apps installed, and "open WhatsApp" means something quite different on a
   * laptop. Mobile renders the buttons; desktop offers the person's page.
   */
  contactTarget?: ContactReminderTarget;
  /** Set when this row is the duplicates nudge, whose CTA opens the review. */
  isDuplicatesNudge?: boolean;
}) {
  // Three fetchers, not one: completing, putting off and answering a prompt are
  // separate submissions and shouldn't share a pending state.
  const completeFetcher = useFetcher();
  const snoozeFetcher = useFetcher();
  const answerFetcher = useFetcher();
  const done = reminder.completedAt !== null;
  const strike = done ? { textDecoration: "line-through" as const } : undefined;
  const heading = reminder.title ?? reminder.body ?? "";
  // Everything this row offers, in offer order — the view-model is the only
  // authority on *what* is offered; this screen owns only how it looks. An
  // ordinary reminder (milestone / birthday / user) offers nothing.
  const actions = reminderActionsOf(reminder, {
    giftTarget,
    isDuplicatesNudge,
    planTarget,
    contactTarget:
      contactTarget === undefined
        ? undefined
        : {
            personId: contactTarget.personId,
            hasMethods: contactTarget.methods.length > 0,
          },
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
      {isReminderEditable(reminder) && reminder.materialized && (
        <>
          <Link to={`/reminders/${reminder.id}/edit`}>Edit</Link>{" "}
        </>
      )}
      {actions.map((action) => {
        const affordance = rowAffordanceFor(action, reminder.id);
        // Each kind is offered at most once per row, so it keys them.
        return (
          <Fragment key={action.kind}>
            {affordance.kind === "answer-plan" ? (
              // ⚠️ One tap, on the row, with no screen in between. The prompt
              // trades several passive rows for one that asks a question, and
              // that only pays off if the common answer costs less than ignoring
              // the old rows did — so it is a button here, not a control behind
              // the "Choose →" link.
              <answerFetcher.Form
                method="post"
                action={affordance.to}
                style={{ display: "inline" }}
              >
                <input
                  type="hidden"
                  name="reminderSchedule"
                  value={JSON.stringify(affordance.schedule)}
                />
                <button type="submit">{affordance.label}</button>
              </answerFetcher.Form>
            ) : affordance.kind === "snooze" ? (
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
      {showsRemove(actions, done, reminder.materialized) && (
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
 * The Reminders screen — the app's home, split by **when**.
 *
 * Four headed lists lead — past due, belated, today, available — then *coming*
 * and *completed* in disclosures. The reasoning for the split, and for which of
 * them "done for the day" counts, is on `bucketReminders`; this screen owns only
 * how it looks. Copy is kept in one table below so the later message-catalog
 * sweep is mechanical.
 */
export function ReminderList() {
  const { reminders, targets, duplicatesNudgeId } = useLoaderData() as {
    reminders: ReminderInWindow[];
    targets: SystemReminderTargets;
    /** The id of today's duplicates nudge, or null when there are no pairs. */
    duplicatesNudgeId: string | null;
  };
  const giftTargetById = new Map(targets.gifts.map((t) => [t.reminderId, t]));
  const planTargetById = new Map(targets.plans.map((t) => [t.reminderId, t]));
  const contactTargetById = new Map(
    targets.contacts.map((t) => [t.reminderId, t]),
  );
  const { pastDue, belated, today, available, coming, done, owed, actionable } =
    bucketReminders(reminders);

  const row = (reminder: ReminderInWindow, withNudgeCta = true) => (
    <ReminderRow
      key={reminder.id}
      reminder={reminder}
      giftTarget={giftTargetById.get(reminder.id)}
      planTarget={planTargetById.get(reminder.id)}
      contactTarget={contactTargetById.get(reminder.id)}
      isDuplicatesNudge={withNudgeCta && reminder.id === duplicatesNudgeId}
    />
  );

  const section = (heading: string, rows: ReminderInWindow[]) =>
    rows.length === 0 ? null : (
      <section>
        <h2>{heading}</h2>
        <ul>{rows.map((r) => row(r))}</ul>
      </section>
    );

  return (
    <main>
      <h1>{TEXT.title}</h1>

      <p>
        <Link to="/reminders/new">{TEXT.add}</Link>
      </p>

      {/* Past due leads: its deadline blew but the occasion is still ahead, so
          acting now has more value than anything else on the screen. Belated
          follows — prominent, but nothing there can be recovered, only
          acknowledged. */}
      {section(TEXT.pastDue, pastDue)}
      {section(TEXT.belated, belated)}
      {section(TEXT.today, today)}

      {/* Which kind of done was reached, said where the owed sections would have
          been. Nothing owed is the line worth saying out loud; nothing left at
          all is a different, quieter one. */}
      {reminders.length > 0 && owed === 0 && (
        <p>{actionable === 0 ? TEXT.allClear : TEXT.noneOwed}</p>
      )}
      {reminders.length === 0 && <p>{TEXT.empty}</p>}

      {/* A month-long gift lives here the whole time, and deliberately does not
          stand between the user and a finished day. */}
      {section(TEXT.available, available)}

      {coming.length > 0 && (
        <details>
          <summary>
            {TEXT.coming} ({coming.length})
          </summary>
          {groupComingByActivation(coming).map((group) => (
            <section key={group.activeFrom}>
              {/* The distance is a moving number, so it is formatted, never
                  written in. */}
              <h3>{formatDueIn(group.activeFrom)}</h3>
              <ul>{group.reminders.map((r) => row(r))}</ul>
            </section>
          ))}
        </details>
      )}

      {done.length > 0 && (
        <details>
          <summary>
            {TEXT.completed} ({done.length})
          </summary>
          <ul>{done.map((r) => row(r, false))}</ul>
        </details>
      )}
    </main>
  );
}
