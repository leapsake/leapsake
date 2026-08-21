import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import type { GiftIdea, GiftIdeaOccasionInput } from "@leapsake/schema";
import {
  type IdeaOccasionRow,
  ideaOccasionRowsOf,
  ideaOccasionsOf,
} from "@leapsake/ui/headless";
import { ChipTextField } from "./ChipTextField";
import { GiftIdeaOccasionsField } from "./GiftIdeaOccasionsField";
import { HeaderSave } from "./HeaderSave";
import { styles } from "../lib/styles";

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
  occasions = [],
  onSubmit,
}: {
  /** Native header title, set here so the header is declared in one place. */
  title: string;
  idea?: GiftIdea;
  /** Space-separated existing tag labels; empty on create. */
  tagNames?: string;
  /** The idea's stored occasions; empty on create. */
  occasions?: readonly {
    id: string;
    occasionType: GiftIdeaOccasionInput["occasion"]["type"];
    occasionId: string;
    targetYear: number | null;
    targetMonth: number | null;
    targetDay: number | null;
  }[];
  onSubmit: (
    value: GiftIdeaFormValue,
    tagsRaw: string,
    occasions: GiftIdeaOccasionInput[],
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState(idea?.title ?? "");
  const [url, setUrl] = useState(idea?.url ?? "");
  const [notes, setNotes] = useState(idea?.notes ?? "");
  const [tags, setTags] = useState(tagNames);
  // Seeded once: this form is remounted per idea (the screen keys on the route),
  // so a later prop change would be a reload, not an edit to discard.
  const [occasionRows, setOccasionRows] = useState<IdeaOccasionRow[]>(() =>
    ideaOccasionRowsOf(occasions),
  );
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
        ideaOccasionsOf(occasionRows),
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
        <TextInput style={styles.input} value={title} onChangeText={setTitle} />
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
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          style={[styles.input, { minHeight: 88, textAlignVertical: "top" }]}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>What it's for</Text>
        <GiftIdeaOccasionsField
          label="Good for…"
          rows={occasionRows}
          onChange={setOccasionRows}
        />
        <Text style={styles.muted}>
          Occasions the idea itself suits — "a good Christmas gift". Who it's
          for is separate, below.
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Tags</Text>
        <ChipTextField
          grammar="tags"
          style={styles.input}
          value={tags}
          onChangeText={setTags}
        />
        <Text style={styles.muted}>Space-separated — each word is a tag.</Text>
      </View>
    </View>
  );
}
