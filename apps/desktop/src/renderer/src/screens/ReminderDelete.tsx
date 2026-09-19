import { type Reminder, reminderLabel } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { reminderCtaOf } from "@leapsake/view-models";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

/**
 * Worded for the row: removing an onboarding nudge is permanent, since a
 * tombstone is never resurrected, so its copy says so.
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
  // A pure derivation; the engine itself must stay out of the renderer bundle.
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
