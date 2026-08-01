import { type Reminder, reminderLabel } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { reminderCtaOf } from "@leapsake/view-models";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

/**
 * The two things this screen can be confirming, worded for the row it was handed.
 *
 * Removing an onboarding nudge has *always* been permanent — the engine
 * soft-deletes it and reconcile never resurrects a tombstoned id — so the second
 * set isn't a new outcome, it is the existing one finally saying what it does.
 * Calling that "Remove reminder?" is what let a user who meant *hide it* get
 * *never show it again* without being told.
 */
const REMOVE_COPY = {
  crumb: "Remove reminder",
  heading: "Remove reminder?",
  confirm: "Remove",
  body: (label: string) => `Remove “${label}”?`,
};

const DISMISS_COPY = {
  crumb: "Don’t ask again",
  heading: "Stop asking about this?",
  confirm: "Don’t ask again",
  body: (label: string) => `Leapsake won’t ask about “${label}” again.`,
};

export function ReminderDelete() {
  const reminder = useLoaderData() as Reminder;
  // The CTA seam is already the authority on which rows are onboarding nudges,
  // and it's a pure derivation the renderer can call — unlike the engine itself,
  // which the renderer must never pull into its bundle.
  const isNudge = reminderCtaOf(reminder)?.kind === "onboarding";
  const copy = isNudge ? DISMISS_COPY : REMOVE_COPY;

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: "Reminders", href: "/reminders" },
        { label: copy.crumb },
      ]}
      heading={copy.heading}
      confirmLabel={copy.confirm}
      cancelTo="/reminders"
      submitting={useSubmitting()}
    >
      {copy.body(reminderLabel(reminder))}
    </ConfirmDelete>
  );
}
