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
import type { DuplicateCandidate } from "@leapsake/core";
import { fullName } from "@leapsake/schema";
import { useCore } from "../lib/core-context";
import { personHref } from "../lib/record-title";
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
 *
 * Two modes, one screen (mirroring desktop's `Duplicates`):
 * - **unscoped** (`/duplicates`) — every outstanding pair, reached from the
 *   People & Pets header link, the Home nudge, or after an import;
 * - **scoped** (`/duplicates?for=<personId>`) — only the pairs involving that
 *   person, where saving a new person lands when the detector finds a match.
 *   Scoped mode is a prompt, so it always offers a way onward ("Not now"); the
 *   pairs stay outstanding and stay linked from the list, the Home nudge, and
 *   both people's own pages until they're merged or dismissed.
 */
export default function DuplicatesScreen() {
  const core = useCore();
  const router = useRouter();
  const { for: focusId } = useLocalSearchParams<{ for?: string }>();
  const scoped = typeof focusId === "string" && focusId !== "";

  const load = useCallback(async () => {
    if (!scoped) {
      return {
        candidates: await core.duplicates.findCandidates(),
        focus: null,
      };
    }
    const [candidates, person] = await Promise.all([
      core.duplicates.findFor(focusId),
      core.people.get(focusId),
    ]);
    // An unresolvable id falls back to the unscoped list rather than erroring:
    // the person may have just been merged away from this very screen.
    if (person === undefined) {
      return {
        candidates: await core.duplicates.findCandidates(),
        focus: null,
      };
    }
    // The person, not a name lifted off them: the two ways out of this screen
    // link to their page, and a link carries the name that page will show
    // (`lib/record-title.ts`). The prose below names them from the same record.
    return { candidates, focus: person };
  }, [core, scoped, focusId]);

  const { data, error, reload } = useFocusedData(load);

  function reject(candidate: DuplicateCandidate) {
    core.duplicates.reject(candidate.a.id, candidate.b.id).then(
      () => reload(),
      (e: unknown) => Alert.alert("Couldn't save", String(e)),
    );
  }

  const focus = data?.focus ?? null;
  const candidates = data?.candidates ?? null;

  return (
    <>
      <Stack.Screen
        options={{
          title: focus !== null ? "Already have them?" : "Review duplicates",
        }}
      />
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : candidates === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : candidates.length === 0 ? (
        <View style={styles.screen}>
          <Text style={styles.muted}>
            {focus !== null
              ? "Nothing else looks like the same person."
              : "No possible duplicates found."}
          </Text>
          {focus !== null && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace(personHref(focus))}
            >
              <Text style={[styles.link, { color: colors.accent }]}>
                Continue
              </Text>
            </Pressable>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.screen}>
          <Text style={styles.muted}>
            {focus !== null
              ? `${fullName(focus)} looks like ${
                  candidates.length === 1
                    ? "someone already in your list"
                    : "people already in your list"
                }. Merge if they're the same; mark the rest so they stop being suggested.`
              : "These pairs look like they might be the same person. Merge the ones that are; mark the rest so they stop being suggested."}
          </Text>
          {candidates.map((candidate) => (
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
          {/* Never a dead end: skipping leaves the pairs outstanding, and they
              stay linked from three other surfaces until resolved. */}
          {focus !== null && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace(personHref(focus))}
            >
              <Text style={[styles.link, { color: colors.accent }]}>
                Not now
              </Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </>
  );
}
