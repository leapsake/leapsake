import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import {
  type CreateReminderInput,
  type Reminder,
  dueMsFromIso,
  isoFromDueMs,
} from "@leapsake/schema";
import { colors, styles } from "../lib/styles";
import { HeaderSave } from "./HeaderSave";
import { MentionTextField } from "./MentionTextField";

/**
 * The shared create/edit form for a Reminder, mirroring the desktop `ReminderForm`.
 * Title and body are both optional free text (at least one required). `#tags` and
 * `@mentions` are typed **inline** in either field — there's no separate input for
 * either — and core parses them out on save. Title and Details use {@link
 * MentionTextField} so an `@` opens a People/Pets picker that splices the token in.
 * The screen owns the actual core call; this component collects input and hands
 * back a {@link CreateReminderInput} (empty → null).
 *
 * Like {@link PersonForm}, it declares its own native header — title plus a
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
  const [due, setDue] = useState(
    reminder?.dueDate != null ? isoFromDueMs(reminder.dueDate) : "",
  );
  const [submitting, setSubmitting] = useState(false);

  // A due date is optional, but if typed it must parse as YYYY-MM-DD.
  const dueTrimmed = due.trim();
  const dueValid = dueTrimmed === "" || dueMsFromIso(dueTrimmed) !== null;
  const canSubmit =
    (title.trim().length > 0 || body.trim().length > 0) &&
    dueValid &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const t = title.trim();
      const b = body.trim();
      await onSubmit({
        title: t === "" ? null : t,
        body: b === "" ? null : b,
        dueDate: dueMsFromIso(dueTrimmed),
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
          <MentionTextField
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Call mom"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Details</Text>
          <MentionTextField
            style={[styles.input, { minHeight: 96, textAlignVertical: "top" }]}
            value={body}
            onChangeText={setBody}
            multiline
            placeholder="Type @ to mention someone; add #tags inline"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Due date</Text>
          <TextInput
            style={[styles.input, !dueValid && { borderColor: colors.danger }]}
            value={due}
            onChangeText={setDue}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.muted}
          />
          {!dueValid ? (
            <Text style={styles.muted}>
              Use the format YYYY-MM-DD, e.g. 2026-08-01.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}
