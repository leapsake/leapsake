import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import type { GiftIdea } from "@leapsake/schema";
import { ChipTextField } from "./ChipTextField";
import { HeaderSave } from "./HeaderSave";
import { colors, styles } from "../lib/styles";

/** The structured value the form hands back; the screen owns the core call. */
export interface GiftIdeaFormValue {
  title: string;
  url: string | null;
  notes: string | null;
}

/**
 * The edit form for a GiftIdea, ported from the desktop `GiftIdeaForm`. Title is
 * required; Link and Notes are optional (blanks become null). Tags ride the same
 * write, as a Person's do — the raw text goes back to the screen, which parses it
 * with `parseTagNames`.
 *
 * There is no *create* screen behind this form on either client: a new idea is
 * captured by the `GiftCaptureForm`, which is the single-payload surface.
 *
 * It is only one section of its screen — the recipients manager and the remove
 * link sit below it — but it is that screen's only *form*, so it declares the
 * native header (title plus a right-aligned {@link HeaderSave}) the way the
 * whole-screen forms do. `expo-router` honours a `Stack.Screen` anywhere in the
 * screen's subtree.
 */
export function GiftIdeaForm({
  title: headerTitle,
  idea,
  tagNames = "",
  onSubmit,
}: {
  /** Native header title, set here so the header is declared in one place. */
  title: string;
  idea?: GiftIdea;
  /** Space-separated existing tag labels; empty on create. */
  tagNames?: string;
  onSubmit: (value: GiftIdeaFormValue, tagsRaw: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(idea?.title ?? "");
  const [url, setUrl] = useState(idea?.url ?? "");
  const [notes, setNotes] = useState(idea?.notes ?? "");
  const [tags, setTags] = useState(tagNames);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const trimmedUrl = url.trim();
      const trimmedNotes = notes.trim();
      await onSubmit(
        {
          title: title.trim(),
          url: trimmedUrl === "" ? null : trimmedUrl,
          notes: trimmedNotes === "" ? null : trimmedNotes,
        },
        tags,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.section}>
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

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Red Ryder BB Gun"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Link</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://…"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          style={[styles.input, { minHeight: 88, textAlignVertical: "top" }]}
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="the 200-shot model; she mentioned it in June"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Tags</Text>
        <ChipTextField
          grammar="tags"
          style={styles.input}
          value={tags}
          onChangeText={setTags}
          placeholder="#books #kitchen"
        />
      </View>
    </View>
  );
}
