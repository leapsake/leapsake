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
import { parseTagNames, tagLabel } from "@leapsake/schema";
import { GiftIdeaForm } from "../../../components/GiftIdeaForm";
import {
  GiftIdeaRecipientsSection,
  type RecipientCandidate,
} from "../../../components/GiftIdeaRecipientsSection";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

/**
 * A gift idea's own page, ported from desktop's `GiftIdeaEdit`: the editable idea
 * (title, link, notes, tags) plus the "Suggested for" recipient manager — the idea
 * end of a gift suggestion. It is also where a gift-idea search hit and a tag
 * page's gift-idea row land, since an idea has no read-only view on either client.
 *
 * Removing the idea cascades to its suggestions, givings, and tags (core owns
 * that), so it asks first — via the native `Alert` the other mobile deletes use,
 * rather than desktop's separate confirm screen.
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
        core.gifts.suggestions.listForIdea(id),
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

  const [idea, tags, suggestions, entities] = data;

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
            () => router.replace("/gifts"),
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
      {/* The form declares this screen's header (title + Save) itself; the
        "no longer exists" branch above sets the title because it isn't mounted
        there. Two `Stack.Screen`s for one route would race over the same options. */}
      <GiftIdeaForm
        title="Edit gift idea"
        idea={idea}
        // Same round-trip as a Person's tags: labels in, parseTagNames out.
        tagNames={tags.map((tag) => tagLabel(tag.name)).join(" ")}
        onSubmit={async (value, tagsRaw) => {
          await core.gifts.ideas.update(id, value, parseTagNames(tagsRaw));
          router.back();
        }}
      />

      <GiftIdeaRecipientsSection
        ideaId={idea.id}
        suggestions={suggestions}
        candidates={candidates}
        onChanged={reload}
      />

      <Pressable accessibilityRole="button" onPress={confirmDelete}>
        <Text style={[styles.link, styles.danger]}>Remove gift idea</Text>
      </Pressable>
    </ScrollView>
  );
}
