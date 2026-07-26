import { type Reminder, type SearchHit, isoFromDueMs } from "@leapsake/schema";
import { useState } from "react";
import { useMessages } from "../../messages/index.js";
import { MentionTextField } from "../fields/MentionTextField.js";
import { FormShell } from "../patterns/FormShell.js";
import { StackedField } from "../primitives/Field.js";

/**
 * The shared create/edit form for a Reminder. Title and body are both optional
 * free text (the write path drops empty fields to null; core requires at least
 * one). `#tags` and `@mentions` are typed **inline** in either field — there is
 * no separate input for either — and are parsed out and applied on save, so the
 * text stays the source of truth. Title and Details are controlled (React state)
 * so the `@mention` picker can splice tokens in, but keep their `name`
 * attributes so the write path reads them from `FormData` exactly as before.
 */
export function ReminderForm({
  reminder,
  search,
  submitting,
}: {
  reminder?: Reminder;
  /** Backs the inline `@`/`#` pickers; must be stable across renders. */
  search: (query: string) => Promise<SearchHit[]>;
  submitting: boolean;
}) {
  const m = useMessages();
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [body, setBody] = useState(reminder?.body ?? "");

  return (
    <FormShell
      submitLabel={m.common.save}
      cancelTo="/reminders"
      submitting={submitting}
    >
      <StackedField label={m.reminderForm.title}>
        <MentionTextField
          name="title"
          value={title}
          onChange={setTitle}
          search={search}
          placeholder={m.reminderForm.titlePlaceholder}
        />
      </StackedField>
      <StackedField label={m.reminderForm.details}>
        <MentionTextField
          name="body"
          value={body}
          onChange={setBody}
          search={search}
          multiline
          rows={4}
          placeholder={m.reminderForm.detailsPlaceholder}
        />
      </StackedField>
      <StackedField label={m.reminderForm.dueDate}>
        <input
          type="date"
          name="dueDate"
          defaultValue={
            reminder?.dueDate == null ? "" : isoFromDueMs(reminder.dueDate)
          }
        />
      </StackedField>
    </FormShell>
  );
}
