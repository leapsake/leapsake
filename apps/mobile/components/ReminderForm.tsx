import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { CreateReminderInput, Reminder } from "@leapsake/schema";
import { colors, styles } from "../lib/styles";

/**
 * The shared create/edit form for a Reminder, mirroring the desktop `ReminderForm`.
 * Title and body are both optional free text (at least one required). `#tags` are
 * typed **inline** in either field — there's no separate tags input — and core
 * parses them out on save. The screen owns the actual core call; this component
 * collects input and hands back a {@link CreateReminderInput} (empty → null).
 */
export function ReminderForm({
  reminder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  reminder?: Reminder;
  submitLabel: string;
  onSubmit: (input: CreateReminderInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [body, setBody] = useState(reminder?.body ?? "");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    (title.trim().length > 0 || body.trim().length > 0) && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const t = title.trim();
      const b = body.trim();
      await onSubmit({ title: t === "" ? null : t, body: b === "" ? null : b });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.headerActions, { justifyContent: "flex-end" }]}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          disabled={submitting}
        >
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={[styles.button, !canSubmit && { opacity: 0.5 }]}
        >
          <Text style={styles.buttonText}>{submitLabel}</Text>
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          autoCapitalize="sentences"
          placeholder="Call mom"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Details</Text>
        <TextInput
          style={[styles.input, { minHeight: 96, textAlignVertical: "top" }]}
          value={body}
          onChangeText={setBody}
          multiline
          autoCapitalize="sentences"
          placeholder="Add #tags inline, e.g. ask about the trip #family"
          placeholderTextColor={colors.muted}
        />
      </View>
    </ScrollView>
  );
}
