import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { tagLabel } from "@leapsake/schema";
import { GiftIdeaForm } from "../../../components/GiftIdeaForm";
import {
  GiftIdeaRecipientsSection,
  type RecipientCandidate,
} from "../../../components/GiftIdeaRecipientsSection";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

/**
 * A gift idea's page: the idea, editable, and who it is for. Removing it
 * cascades to its recipients and tags, so it asks first.
 */
export default function GiftIdeaEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const load = useCallback(
    () =>
      Promise.all([
        core.gifts.ideas.get(id),
        core.tags.listForGiftIdea(id),
        core.gifts.recipients.listForIdea(id),
        core.views.entityList(),
      ]),
    [core, id],
  );
  const { data, error, reload } = useFocusedData(load);

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }

  if (data === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  const [idea, tags, recipients, entities] = data;

  if (idea === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Gift idea" }} />
        <Text style={styles.muted}>This gift idea no longer exists.</Text>
      </View>
    );
  }

  const candidates: RecipientCandidate[] = entities.map((e) => ({
    type: e.type,
    id: e.id,
    label: e.label,
  }));

  function confirmDelete() {
    Alert.alert("Remove gift idea", `Remove “${idea?.title}”?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          core.gifts.ideas.softDelete(id).then(
            // Down to the catalog in the tabs underneath, not a `replace`.
            () => router.dismissTo("/gifts"),
            (e: unknown) => Alert.alert("Couldn't remove", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      {/* The form declares the header; two `Stack.Screen`s would race. */}
      <GiftIdeaForm
        title="Edit gift idea"
        idea={idea}
        // Labels in; the form hands them back parsed.
        tagNames={tags.map((tag) => tagLabel(tag.name)).join(" ")}
        onSubmit={async (input, tagNames) => {
          await core.gifts.ideas.update(id, input, tagNames);
          router.back();
        }}
      />

      <GiftIdeaRecipientsSection
        ideaId={idea.id}
        recipients={recipients}
        candidates={candidates}
        onChanged={reload}
      />

      <Pressable
        accessibilityRole="button"
        onPress={confirmDelete}
        style={[styles.button, styles.buttonDestructive, styles.buttonBlock]}
      >
        <Text style={styles.buttonText}>Remove gift idea</Text>
      </Pressable>
    </ScrollView>
  );
}
