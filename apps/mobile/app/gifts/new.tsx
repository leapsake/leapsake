import { useCallback } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type PartyOption, partyKey } from "@leapsake/ui/headless";
import { GiftCaptureForm } from "../../components/GiftCaptureForm";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { styles } from "../../lib/styles";

/**
 * Add a gift — the standalone create screen (the Gifts tab's "+ Add" action),
 * ported from desktop's `GiftCreate`. Type a name/URL to capture an idea; add
 * people/pets to suggest it; add dates under a recipient to log givings.
 *
 * Reached with a recipient already chosen (`?recipient=<type>:<id>`) from a person
 * or pet's Gifts section, and when a completed `🎁 gift` reminder hands off — then
 * the picker collapses to that one person or pet and the form opens on a date row,
 * since the answer to "record what you gave" is a giving, not a shortlist. An
 * unresolvable id falls back to the ordinary picker.
 *
 * **Where saving lands depends on how you got here.** Arriving with a recipient
 * means arriving from somewhere that already shows that recipient's gifts, so it
 * goes back there; the Gifts tab's own "+ Add" has nowhere to go back to that
 * would show the new gift, so it lands on the catalog.
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

  // The form declares the header (title + Save) itself, so the title is set here
  // only for the branches where it isn't mounted yet. Two `Stack.Screen`s for one
  // route would otherwise race over the same options.
  if (error !== null || data === null) {
    return (
      <>
        <Stack.Screen options={{ title: "Add a gift" }} />
        <View style={styles.screen}>
          {error !== null ? (
            <Text style={styles.danger}>{error}</Text>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      </>
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
      : candidates.find((c) => partyKey(c) === recipient);

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      {fixedRecipient !== undefined && (
        <Text style={styles.muted}>
          Recording a gift for {fixedRecipient.label}.
        </Text>
      )}

      <GiftCaptureForm
        title="Add a gift"
        ideaPool={ideas}
        fixedRecipient={fixedRecipient}
        recipientCandidates={
          fixedRecipient === undefined ? candidates : undefined
        }
        startWithGiving={fixedRecipient !== undefined}
        onSaved={() =>
          fixedRecipient === undefined
            ? router.replace("/gifts")
            : router.back()
        }
      />
    </ScrollView>
  );
}
