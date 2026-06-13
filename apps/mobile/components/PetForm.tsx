import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { type CreatePetInput, type Gender, type Pet } from "@leapsake/schema";
import { GenderField } from "./GenderField";
import { colors, styles } from "../lib/styles";

/**
 * The shared create/edit form, ported from the desktop `PetForm` (and mirroring
 * mobile's `PersonForm`). A pet is a simpler entity than a person — a single
 * `name` field rather than first/middle/last — but the gender + tags + submit
 * shape is identical. The screen owns the actual core call (and the native
 * header title); this component collects input and hands back the structured
 * `CreatePetInput` plus the raw tags text (the screen parses it with
 * `parseTagNames`, mirroring desktop).
 */
export function PetForm({
  pet,
  tagNames = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  pet?: Pet;
  /** Space-separated existing tag labels; empty on create. */
  tagNames?: string;
  submitLabel: string;
  onSubmit: (input: CreatePetInput, tagsRaw: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(pet?.name ?? "");
  const [gender, setGender] = useState<Gender | null>(pet?.gender ?? null);
  const [tags, setTags] = useState(tagNames);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), gender }, tags);
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
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder="Name"
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
          placeholder="#Friend #Neighbor"
          placeholderTextColor={colors.muted}
        />
      </View>
    </ScrollView>
  );
}
