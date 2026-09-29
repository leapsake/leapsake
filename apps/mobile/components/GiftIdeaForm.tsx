import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import type {
  GiftIdea,
  GiftIdeaDraft,
  GiftIdeaDraftResult,
} from "@leapsake/schema";
import { useGiftIdeaForm } from "@leapsake/ui/headless";
import { ChipTextField } from "./ChipTextField";
import { useHeaderSave } from "./HeaderSave";
import { styles } from "../lib/styles";

type GiftIdeaSubmit = Extract<GiftIdeaDraftResult, { ok: true }>;

const TEXT = {
  title: "Title",
  link: "Link",
  notes: "Notes",
  tags: "Tags",
  tagsHint: "Space-separated — each word is a tag.",
  titleRequired: "Give the gift idea a title before saving.",
};

/** A gift idea's edit form, Save in the header; the screen owns the core
 *  call. */
export function GiftIdeaForm({
  title,
  idea,
  tagNames = "",
  onSubmit,
}: {
  /** Native header title, set here so the header is declared in one place. */
  title: string;
  idea?: GiftIdea;
  /** Space-separated existing tag labels; empty on create. */
  tagNames?: string;
  onSubmit: (
    input: GiftIdeaSubmit["input"],
    tags: GiftIdeaSubmit["tags"],
  ) => Promise<void>;
}) {
  const form = useGiftIdeaForm(idea, tagNames);
  const [submitting, setSubmitting] = useState(false);
  const headerRight = useHeaderSave({
    problem: form.errors.title === "required" ? TEXT.titleRequired : undefined,
    saving: submitting,
    onPress: () => void handleSubmit(),
  });

  async function handleSubmit() {
    const shaped = form.submit();
    if (shaped === null || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(shaped.input, shaped.tags);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title, headerRight }} />
      <GiftIdeaFields fields={form.fields} set={form.set} />
    </>
  );
}

/** A gift idea's fields: title, link, notes and tags. */
export function GiftIdeaFields({
  fields,
  set,
}: {
  fields: GiftIdeaDraft;
  set: <K extends keyof GiftIdeaDraft>(key: K, value: GiftIdeaDraft[K]) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{TEXT.title}</Text>
        <TextInput
          style={styles.input}
          value={fields.title}
          onChangeText={(text) => set("title", text)}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{TEXT.link}</Text>
        <TextInput
          style={styles.input}
          value={fields.url}
          onChangeText={(text) => set("url", text)}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{TEXT.notes}</Text>
        <TextInput
          style={[styles.input, { minHeight: 88, textAlignVertical: "top" }]}
          value={fields.notes}
          onChangeText={(text) => set("notes", text)}
          multiline
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{TEXT.tags}</Text>
        <ChipTextField
          grammar="tags"
          style={styles.input}
          value={fields.tags}
          onChangeText={(text) => set("tags", text)}
        />
        <Text style={styles.muted}>{TEXT.tagsHint}</Text>
      </View>
    </View>
  );
}
