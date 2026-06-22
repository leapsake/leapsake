import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import type { DuplicateCandidate } from "@leapsake/core";
import { useCore } from "../lib/core-context";
import { useFocusedData } from "../lib/useFocusedData";
import { colors, styles } from "../lib/styles";

/** Human-friendly tier copy; falls back to the raw tier if ever extended. */
const TIER_LABEL: Record<string, string> = {
  high: "Very likely the same",
  medium: "Possibly the same",
};

/**
 * Review duplicates — the Expo mirror of the desktop detection surface
 * (reconciliation Increment B). Lists candidate pairs with the reasons they
 * matched; "Merge" routes into the existing people merge confirm flow and
 * "Not the same" records the rejection so no device re-nags. Detection only —
 * the merge itself still goes through the confirm.
 */
export default function DuplicatesScreen() {
  const core = useCore();
  const router = useRouter();
  const load = useCallback(() => core.duplicates.findCandidates(), [core]);
  const { data, error, reload } = useFocusedData(load);

  function reject(candidate: DuplicateCandidate) {
    core.duplicates.reject(candidate.a.id, candidate.b.id).then(
      () => reload(),
      (e: unknown) => Alert.alert("Couldn't save", String(e)),
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Review duplicates" }} />
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : data === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.screen}>
          <Text style={styles.muted}>No possible duplicates found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.screen}>
          <Text style={styles.muted}>
            These pairs look like they might be the same person. Merge the ones
            that are; mark the rest so they stop being suggested.
          </Text>
          {data.map((candidate) => (
            <View
              key={`${candidate.a.id}:${candidate.b.id}`}
              style={styles.row}
            >
              <Text style={styles.rowText}>
                {candidate.a.name} &amp; {candidate.b.name}
              </Text>
              <Text style={styles.muted}>
                {TIER_LABEL[candidate.tier] ?? candidate.tier}
              </Text>
              {candidate.reasons.map((reason) => (
                <Text key={reason} style={styles.muted}>
                  • {reason}
                </Text>
              ))}
              <View style={styles.rowActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push(
                      `/people/${candidate.a.id}/merge?loser=${candidate.b.id}`,
                    )
                  }
                >
                  <Text style={[styles.link, { color: colors.accent }]}>
                    Merge
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => reject(candidate)}
                >
                  <Text style={styles.link}>Not the same</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </>
  );
}
