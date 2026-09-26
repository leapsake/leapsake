import {
  type Reminder,
  type ReminderDraft,
  type ReminderDraftResult,
  type SearchHit,
  earliestDueIso,
  isoFromParts,
  partsFromIso,
} from "@leapsake/schema";
import { useReminderForm } from "../../headless/index.js";
import { type Messages, useMessages } from "../../messages/index.js";
import { ChipTextField } from "../fields/ChipTextField.js";
import { FormShell } from "../patterns/FormShell.js";
import { StackedField } from "../primitives/Field.js";

/**
 * The create/edit form for a Reminder: {@link useReminderForm}'s draft rendered by
 * {@link ReminderFields}. `#tags` and `@mentions` are typed inline and parsed on save.
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
  const form = useReminderForm(reminder);

  return (
    <FormShell
      submitLabel={m.common.save}
      cancelTo="/reminders"
      submitting={submitting}
      problem={reminderProblem(form.errors, m)}
    >
      <ReminderFields
        fields={form.fields}
        set={form.set}
        search={search}
        earliestDue={earliestDueIso(reminder?.dueDate ?? null)}
      />
    </FormShell>
  );
}

type ReminderErrors = Partial<
  Extract<ReminderDraftResult, { ok: false }>["errors"]
>;

function reminderProblem(
  errors: ReminderErrors,
  m: Messages,
): string | undefined {
  if (errors.title === "required") return m.reminderForm.textRequired;
  if (errors.due === "invalid") return m.reminderForm.dueInvalid;
  if (errors.due === "past") return m.reminderForm.duePast;
  return undefined;
}

/**
 * A reminder's fields, posted under the names the write path reads. Title and
 * Details carry their stored text (tokens and all) on hidden inputs.
 */
export function ReminderFields({
  fields,
  set,
  search,
  earliestDue,
}: {
  fields: ReminderDraft;
  set: <K extends keyof ReminderDraft>(key: K, value: ReminderDraft[K]) => void;
  search: (query: string) => Promise<SearchHit[]>;
  /** The date input's `min`, so a browser refuses a past day with no JS. */
  earliestDue: string;
}) {
  const m = useMessages();

  return (
    <>
      <StackedField label={m.reminderForm.title}>
        <ChipTextField
          name="title"
          value={fields.title}
          onChange={(title) => set("title", title)}
          search={search}
          placeholder={m.reminderForm.titlePlaceholder}
        />
      </StackedField>
      <StackedField label={m.reminderForm.details}>
        <ChipTextField
          name="body"
          value={fields.body}
          onChange={(body) => set("body", body)}
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
          min={earliestDue}
          value={isoFromParts(fields.due)}
          onChange={(e) => set("due", partsFromIso(e.target.value))}
        />
      </StackedField>
    </>
  );
}
