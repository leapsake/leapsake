import { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  GiftCaptureForm,
  type PartyOption,
} from "../../components/GiftCaptureForm";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { styles } from "../../lib/styles";

/**
 * Add a gift — the standalone create screen (the Gifts tab's "+ Add" action),
 * ported from desktop's `GiftCreate`. Type a name/URL to capture an idea; add
 * people/pets to suggest it; add dates under a recipient to log givings. Returns
 * to the Gifts tab on save.
 *
 * Reached with a recipient already chosen (`?recipient=<type>:<id>`) when a
 * completed `🎁 gift` reminder hands off — then the picker collapses to that one
 * person or pet and the form opens on a date row, since the answer to "record what
 * you gave" is a giving, not a shortlist. An
 * unresolvable id falls back to the ordinary picker.
 */
export default function GiftCreateScreen() {
  const core = useCore();
  const router = useRouter();
  const { recipient } = useLocalSearchParams<{ recipient?: string }>();

  const load = useCallback(
    () => Promise.all([core.gifts.ideas.list(), core.views.entityList()]),
    [core],
  );
  const { data, error } = useFocusedData(load);

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

  const [ideas, entities] = data;
  const candidates: PartyOption[] = entities.map((e) => ({
    type: e.type,
    id: e.id,
    label: e.label,
  }));
  const fixedRecipient =
    recipient === undefined
      ? undefined
      : candidates.find((c) => `${c.type}:${c.id}` === recipient);

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "Add a gift" }} />

      {fixedRecipient !== undefined && (
        <Text style={styles.muted}>
          Recording a gift for {fixedRecipient.label}.
        </Text>
      )}

      <GiftCaptureForm
        ideaPool={ideas}
        fixedRecipient={fixedRecipient}
        recipientCandidates={
          fixedRecipient === undefined ? candidates : undefined
        }
        startWithGiving={fixedRecipient !== undefined}
        onSaved={() => router.replace("/gifts")}
      />

      <Pressable accessibilityRole="button" onPress={() => router.back()}>
        <Text style={styles.link}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}
