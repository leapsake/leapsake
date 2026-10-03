import { useState } from "react";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import type {
  Reminder,
  ReminderDraft,
  ReminderDraftResult,
} from "@leapsake/schema";
import { useReminderForm } from "@leapsake/ui/headless";
import { editDueDate } from "../lib/date-parts";
import { styles } from "../lib/styles";
import { DatePartsFields } from "./DatePartsFields";
import { useHeaderSave } from "./HeaderSave";
import { ChipTextField } from "./ChipTextField";
import { FormScrollView } from "./FormScrollView";

type ReminderSubmit = Extract<ReminderDraftResult, { ok: true }>;
type ReminderErrors = Partial<
  Extract<ReminderDraftResult, { ok: false }>["errors"]
>;

const TEXT = {
  back: "Back",
  title: "Title",
  details: "Details",
  detailsHint: "Type @ to mention someone; add #tags inline.",
  dueLabel: "Due date (optional)",
  textRequired: "Give the reminder a title or some details before saving.",
  due: {
    invalid: "Enter a month, day and year that exist.",
    past: "Pick today or a later date.",
  },
} as const;

/** A reminder's create or edit form, Save in the header; the screen owns the
 *  core call. */
export function ReminderForm({
  title,
  reminder,
  onSubmit,
}: {
  /** Native header title, set here so the header is declared in one place. */
  title: string;
  reminder?: Reminder;
  onSubmit: (input: ReminderSubmit["input"]) => Promise<void>;
}) {
  const form = useReminderForm(reminder);
  // Until a year is typed, it follows the month and day to their next
  // occurrence.
  const [yearTouched, setYearTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const headerRight = useHeaderSave({
    problem: reminderProblem(form.errors),
    saving: submitting,
    onPress: () => void handleSubmit(),
  });

  async function handleSubmit() {
    const shaped = form.submit();
    if (shaped === null) return;
    setSubmitting(true);
    try {
      await onSubmit(shaped.input);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen
        // Spelled out: the detail screen below has no title to borrow.
        options={{ title, headerBackTitle: TEXT.back, headerRight }}
      />
      <ReminderFields
        fields={form.fields}
        set={form.set}
        errors={form.errors}
        onDueChange={(parts) => {
          const next = editDueDate(
            { parts: form.fields.due, yearTouched },
            parts,
          );
          setYearTouched(next.yearTouched);
          form.set("due", next.parts);
        }}
      />
    </>
  );
}

function reminderProblem(errors: ReminderErrors): string | undefined {
  if (errors.title === "required") return TEXT.textRequired;
  return errors.due === undefined ? undefined : TEXT.due[errors.due];
}

/** A reminder's fields: title, details and an optional due date. */
export function ReminderFields({
  fields,
  set,
  errors,
  onDueChange,
}: {
  fields: ReminderDraft;
  set: <K extends keyof ReminderDraft>(key: K, value: ReminderDraft[K]) => void;
  errors: ReminderErrors;
  onDueChange: (parts: ReminderDraft["due"]) => void;
}) {
  return (
    <FormScrollView contentContainerStyle={styles.screen}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{TEXT.title}</Text>
        <ChipTextField
          testID="reminder-title"
          style={styles.input}
          value={fields.title}
          onChangeText={(text) => set("title", text)}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{TEXT.details}</Text>
        <ChipTextField
          testID="reminder-body"
          style={[styles.input, { minHeight: 96, textAlignVertical: "top" }]}
          value={fields.body}
          onChangeText={(text) => set("body", text)}
          multiline
        />
        <Text style={styles.muted}>{TEXT.detailsHint}</Text>
      </View>

      <DatePartsFields
        label={TEXT.dueLabel}
        value={fields.due}
        onChange={onDueChange}
        testIDPrefix="reminder-due"
        error={errors.due === undefined ? null : TEXT.due[errors.due]}
      />
    </FormScrollView>
  );
}
