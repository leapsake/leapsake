import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import type { CreateReminderInput, Reminder } from "@leapsake/schema";
import { checkDueDate, dueDateDraft, editDueDate } from "../lib/date-parts";
import { styles } from "../lib/styles";
import { DatePartsFields } from "./DatePartsFields";
import { HeaderSave } from "./HeaderSave";
import { ChipTextField } from "./ChipTextField";

const DUE_DATE = {
  label: "Due date (optional)",
  accessibilityLabels: {
    month: "Due month",
    day: "Due day",
    year: "Due year",
  },
  invalid: "Enter a month, day and year that exist.",
  past: "Pick today or a later date.",
} as const;

/**
 * The shared create/edit form for a Reminder, mirroring the desktop `ReminderForm`.
 * Title and body are both optional free text (at least one required). `#tags` and
 * `@mentions` are typed **inline** in either field — there's no separate input for
 * either — and core parses them out on save. Title and Details use {@link
 * ChipTextField} so an `@` opens a People/Pets picker that splices the token in.
 * The screen owns the actual core call; this component collects input and hands
 * back a {@link CreateReminderInput} (empty → null).
 *
 * Like {@link MilestoneForm}, it declares its own native header — title plus a
 * right-aligned {@link HeaderSave} — so the screen doesn't have to lift `canSubmit`
 * out of it just to render a header button.
 */
export function ReminderForm({
  title: headerTitle,
  reminder,
  onSubmit,
}: {
  /** Native header title, set here so the header is declared in one place. */
  title: string;
  reminder?: Reminder;
  onSubmit: (input: CreateReminderInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [body, setBody] = useState(reminder?.body ?? "");
  const savedDueMs = reminder?.dueDate ?? null;
  const [due, setDue] = useState(() => dueDateDraft(savedDueMs));
  const [submitting, setSubmitting] = useState(false);

  const dueCheck = checkDueDate(due.parts, savedDueMs);
  const canSubmit =
    (title.trim().length > 0 || body.trim().length > 0) &&
    dueCheck.ok &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit || !dueCheck.ok) return;
    setSubmitting(true);
    try {
      const t = title.trim();
      const b = body.trim();
      await onSubmit({
        title: t === "" ? null : t,
        body: b === "" ? null : b,
        dueDate: dueCheck.dueMs,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: headerTitle,
          // Spelled out because the detail screen this is pushed from carries no
          // title, and a native stack takes a back button's label from there —
          // without this, editing a reminder leaves a bare chevron to go back by.
          headerBackTitle: "Back",
          headerRight: () => (
            <HeaderSave
              canSave={canSubmit}
              saving={submitting}
              onPress={() => void handleSubmit()}
            />
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Title</Text>
          <ChipTextField
            testID="reminder-title"
            style={styles.input}
            value={title}
            onChangeText={setTitle}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Details</Text>
          <ChipTextField
            testID="reminder-body"
            style={[styles.input, { minHeight: 96, textAlignVertical: "top" }]}
            value={body}
            onChangeText={setBody}
            multiline
          />
          <Text style={styles.muted}>
            Type @ to mention someone; add #tags inline.
          </Text>
        </View>

        <DatePartsFields
          label={DUE_DATE.label}
          value={due.parts}
          onChange={(parts) => setDue((draft) => editDueDate(draft, parts))}
          accessibilityLabels={DUE_DATE.accessibilityLabels}
          testIDPrefix="reminder-due"
          invalid={!dueCheck.ok}
        />
        {!dueCheck.ok ? (
          <Text style={styles.muted}>{DUE_DATE[dueCheck.problem]}</Text>
        ) : null}
      </ScrollView>
    </>
  );
}
