import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  type CreatePersonInput,
  type Gender,
  type Person,
} from "@leapsake/schema";
import { GenderField } from "./GenderField";
import { colors, styles } from "../lib/styles";

/**
 * The shared create/edit form, ported from the desktop `PersonForm`. The fields
 * are the same for `people/new` and `people/[id]/edit` — add one here and both
 * screens gain it. The screen owns the actual core call (and the native header
 * title); this component collects input and hands back the structured
 * `CreatePersonInput` plus the raw tags text (the screen parses it with
 * `parseTagNames`, mirroring desktop).
 */
export function PersonForm({
  person,
  tagNames = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  person?: Person;
  /** Space-separated existing tag labels; empty on create. */
  tagNames?: string;
  submitLabel: string;
  onSubmit: (input: CreatePersonInput, tagsRaw: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState(person?.firstName ?? "");
  const [middleName, setMiddleName] = useState(person?.middleName ?? "");
  const [lastName, setLastName] = useState(person?.lastName ?? "");
  const [gender, setGender] = useState<Gender | null>(person?.gender ?? null);
  const [tags, setTags] = useState(tagNames);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    firstName.trim().length > 0 && lastName.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const trimmedMiddle = middleName.trim();
      await onSubmit(
        {
          firstName: firstName.trim(),
          middleName: trimmedMiddle === "" ? null : trimmedMiddle,
          lastName: lastName.trim(),
          gender,
        },
        tags,
      );
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
        <Text style={styles.fieldLabel}>First name</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          placeholder="First name"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Middle name</Text>
        <TextInput
          style={styles.input}
          value={middleName}
          onChangeText={setMiddleName}
          autoCapitalize="words"
          placeholder="Middle name (optional)"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Last name</Text>
        <TextInput
          style={styles.input}
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
          placeholder="Last name"
          placeholderTextColor={colors.muted}
        />
      </View>

      <GenderField value={gender} onChange={setGender} />

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Tags</Text>
        <TextInput
          style={styles.input}
          value={tags}
          onChangeText={setTags}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="#Friend #Colleague"
          placeholderTextColor={colors.muted}
        />
      </View>
    </ScrollView>
  );
}
