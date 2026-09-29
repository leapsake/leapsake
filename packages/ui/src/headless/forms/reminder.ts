import {
  type Reminder,
  reminderDraftOf,
  reminderInputOf,
} from "@leapsake/schema";
import { useDraftForm } from "./use-draft-form.js";

/** The reminder form's state, from the reminder being edited or blanks. */
export function useReminderForm(
  reminder?: Pick<Reminder, "title" | "body" | "dueDate">,
) {
  const savedDueMs = reminder?.dueDate ?? null;
  return useDraftForm(
    () => reminderDraftOf(reminder),
    (draft) => reminderInputOf(draft, savedDueMs),
  );
}
