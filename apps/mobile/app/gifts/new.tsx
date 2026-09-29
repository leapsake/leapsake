import { useCallback } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type PartyOption, partyKey } from "@leapsake/ui/headless";
import { GiftCaptureForm } from "../../components/GiftCaptureForm";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { styles } from "../../lib/styles";

/**
 * Add a gift. `?recipient=` fixes who it is for, and saving goes back there;
 * `?given=1`, not the recipient, ticks it as already given.
 */
export default function GiftCreateScreen() {
  const core = useCore();
  const router = useRouter();
  const { recipient, given } = useLocalSearchParams<{
    recipient?: string;
    given?: string;
  }>();

  const load = useCallback(
    () => Promise.all([core.gifts.ideas.list(), core.views.entityList()]),
    [core],
  );
  const { data, error } = useFocusedData(load);

  // The form declares the header itself; two `Stack.Screen`s would race.
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
        // The only mention of the recipient, the picker being hidden.
        <Text style={styles.muted}>A gift for {fixedRecipient.label}.</Text>
      )}

      <GiftCaptureForm
        title="Add a gift"
        ideaPool={ideas}
        fixedRecipient={fixedRecipient}
        recipientCandidates={
          fixedRecipient === undefined ? candidates : undefined
        }
        startGiven={given === "1"}
        onSaved={() =>
          fixedRecipient === undefined
            ? router.dismissTo("/gifts")
            : router.back()
        }
      />
    </ScrollView>
  );
}
