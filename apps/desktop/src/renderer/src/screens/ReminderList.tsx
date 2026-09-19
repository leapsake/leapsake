import type {
  ContactReminderTarget,
  GiftReminderTarget,
  LinkPartnerReminderTarget,
  PartnershipReminderTarget,
  PlanReminderTarget,
  ReminderInWindow,
  SystemReminderTargets,
} from "@leapsake/core";
import {
  formatBackIn,
  formatComingIn,
  formatDueCountdown,
  formatDueIn,
  isReminderEditable,
} from "@leapsake/schema";
import { ReminderText } from "@leapsake/ui/web";
import {
  type ReminderCountdown,
  type ReminderSection,
  bucketReminders,
  reminderActionKey,
  reminderActionsOf,
  reminderCountdownOf,
} from "@leapsake/view-models";
import { Fragment } from "react";
import { Link, useFetcher, useLoaderData } from "react-router-dom";
import { rowAffordanceFor, showsRemove } from "../lib/reminder-row";

/**
 * Every user-visible string on this screen. None takes a value; counts render
 * beside them, so no sentence is built from fragments.
 */
const TEXT = {
  title: "Reminders",
  add: "Add reminder",
  belated: "Belated",
  today: "Today",
  next7: "Next 7 days",
  later: "Later",
  completed: "Completed",
  /** Nothing left on Today or in Belated. */
  allDone: "All done for today. Go enjoy it.",
  /** No reminders at all — a first run, not a finished day. */
  empty: "No reminders yet.",
} as const;

/**
 * A row's countdown in words, to the date its section sorts it by, which is
 * `reminderCountdownOf`'s choice.
 */
function countdownText(countdown: ReminderCountdown): string {
  switch (countdown.kind) {
    case "due":
      return formatDueCountdown(countdown.date);
    case "back":
      return formatBackIn(countdown.date);
    case "coming":
      return formatComingIn(countdown.date);
    case "shown":
      return formatDueIn(countdown.date);
  }
}

/**
 * One reminder row: toggle, heading, offered actions, edit/remove, then the
 * body as details when there is a title. Inline `#tags` link to their pages.
 */
function ReminderRow({
  reminder,
  giftTarget,
  planTarget,
  contactTarget,
  partnershipTarget,
  linkPartnerTarget,
  isDuplicatesNudge = false,
  section,
}: {
  reminder: ReminderInWindow;
  /** Which section the row is in, which decides its countdown. */
  section: ReminderSection;
  /** Set when this is a `🎁 gift` reminder — see {@link giftCtaFor}. */
  giftTarget?: GiftReminderTarget;
  /** Set when this is a `🗓 plan` prompt: its question and offers. */
  planTarget?: PlanReminderTarget;
  /**
   * Set when this is a `🎉 wish` about a person; a CTA only when they have no
   * way to be reached. Contact actions are built for a phone, so none here.
   */
  contactTarget?: ContactReminderTarget;
  /** Set when this row asks for a partnership date, e.g. an anniversary. */
  partnershipTarget?: PartnershipReminderTarget;
  /** Set when this row is about a wedding whose other party is unknown. */
  linkPartnerTarget?: LinkPartnerReminderTarget;
  /** Set when this row is the duplicates nudge, whose CTA opens the review. */
  isDuplicatesNudge?: boolean;
}) {
  // Separate submissions, so they don't share a pending state.
  const completeFetcher = useFetcher();
  const snoozeFetcher = useFetcher();
  const answerFetcher = useFetcher();
  const done = reminder.completedAt !== null;
  const strike = done ? { textDecoration: "line-through" as const } : undefined;
  const heading = reminder.title ?? reminder.body ?? "";
  const countdown = reminderCountdownOf(reminder, section);
  // In offer order; the view-model alone decides what is offered.
  const actions = reminderActionsOf(reminder, {
    giftTarget,
    isDuplicatesNudge,
    planTarget,
    partnershipTarget,
    linkPartnerTarget,
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
      {countdown !== null && (
        <>
          <small style={{ color: "#666" }}>
            {countdownText(countdown)}
          </small>{" "}
        </>
      )}
      {/* The engine owns an automatic reminder's text, so no Edit link. */}
      {isReminderEditable(reminder) && reminder.materialized && (
        <>
          <Link to={`/reminders/${reminder.id}/edit`}>Edit</Link>{" "}
        </>
      )}
      {actions.map((action) => {
        const affordance = rowAffordanceFor(action, reminder.id);
        return (
          // Two CTAs and three put-offs can share a `kind`, so key past it.
          <Fragment key={reminderActionKey(action)}>
            {affordance.kind === "answer-plan" ? (
              // One tap on the row: the common answer must cost less than
              // ignoring the row, so it is not behind the "Choose →" link.
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
              // A fetcher post, so the row leaves the list in place.
              <snoozeFetcher.Form
                method="post"
                action={affordance.to}
                style={{ display: "inline" }}
              >
                <input type="hidden" name="days" value={affordance.days} />
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
 * The home screen, split by when: Belated and Today lead, then Next 7 days with
 * Later inside it, then Completed. The split is `bucketReminders`'s.
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
  const partnershipTargetById = new Map(
    targets.partnerships.map((t) => [t.reminderId, t]),
  );
  const linkPartnerTargetById = new Map(
    targets.linkPartners.map((t) => [t.reminderId, t]),
  );
  const { belated, today, next7, later, done, owed } =
    bucketReminders(reminders);

  const row = (
    reminder: ReminderInWindow,
    section: ReminderSection,
    withNudgeCta = true,
  ) => (
    <ReminderRow
      key={reminder.id}
      reminder={reminder}
      section={section}
      giftTarget={giftTargetById.get(reminder.id)}
      planTarget={planTargetById.get(reminder.id)}
      contactTarget={contactTargetById.get(reminder.id)}
      partnershipTarget={partnershipTargetById.get(reminder.id)}
      linkPartnerTarget={linkPartnerTargetById.get(reminder.id)}
      isDuplicatesNudge={withNudgeCta && reminder.id === duplicatesNudgeId}
    />
  );

  const headedList = (
    heading: string,
    key: ReminderSection,
    rows: ReminderInWindow[],
  ) =>
    rows.length === 0 ? null : (
      <section>
        <h2>{heading}</h2>
        <ul>{rows.map((r) => row(r, key))}</ul>
      </section>
    );

  // Inside Next 7 days, or on its own when that is empty.
  const laterDisclosure = later.length > 0 && (
    <details>
      <summary>
        {TEXT.later} ({later.length})
      </summary>
      <ul>{later.map((r) => row(r, "later"))}</ul>
    </details>
  );

  return (
    <main>
      <h1>{TEXT.title}</h1>

      <p>
        <Link to="/reminders/new">{TEXT.add}</Link>
      </p>

      {/* Belated puts rows whose occasion is still ahead first. */}
      {headedList(TEXT.belated, "belated", belated)}
      {headedList(TEXT.today, "today", today)}

      {/* Nothing left that can be done today. */}
      {reminders.length > 0 && owed === 0 && <p>{TEXT.allDone}</p>}
      {reminders.length === 0 && <p>{TEXT.empty}</p>}

      {next7.length > 0 ? (
        <details>
          <summary>
            {TEXT.next7} ({next7.length})
          </summary>
          <ul>{next7.map((r) => row(r, "next7"))}</ul>
          {laterDisclosure}
        </details>
      ) : (
        laterDisclosure
      )}

      {done.length > 0 && (
        <details>
          <summary>
            {TEXT.completed} ({done.length})
          </summary>
          <ul>{done.map((r) => row(r, "done", false))}</ul>
        </details>
      )}
    </main>
  );
}
