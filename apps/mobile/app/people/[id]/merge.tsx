import { useCallback } from "react";
import { Alert, Pressable, ScrollView, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type Person, fullName } from "@leapsake/schema";
import { useCore } from "../../../lib/core-context";
import { personHref } from "../../../lib/record-title";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";
import { LoadState } from "../../../components/LoadState";

/**
 * Merge a duplicate into the person viewed: everything of its moves onto
 * them, then it is removed, which cannot be undone.
 */
export default function PersonMergeScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, loser } = useLocalSearchParams<{ id: string; loser?: string }>();
  const load = useCallback(
    async () => ({
      person: await core.people.get(id),
      people: await core.people.list(),
    }),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

  function confirmMerge(survivor: Person, duplicate: Person) {
    Alert.alert(
      "Merge person",
      `Merge ${fullName(duplicate)} into ${fullName(survivor)}? ` +
        `Everything on ${fullName(duplicate)} moves over and the duplicate is ` +
        "deleted. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Merge",
          style: "destructive",
          onPress: () => {
            core.people.merge(survivor.id, duplicate.id).then(
              () => router.replace(personHref(survivor)),
              (e: unknown) => Alert.alert("Couldn't merge", String(e)),
            );
          },
        },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Merge duplicate" }} />
      {error !== null || data === null || data.person === undefined ? (
        <LoadState error={error} />
      ) : (
        (() => {
          const survivor = data.person;
          const others = data.people
            .filter((p) => p.id !== survivor.id)
            // Float the duplicate to the top when arriving from "Review
            // duplicates" (?loser=…), so the obvious choice is the first tap.
            .sort((x, y) => (x.id === loser ? -1 : y.id === loser ? 1 : 0));
          return (
            <ScrollView contentContainerStyle={styles.screen}>
              <Text style={styles.muted}>
                Pick the duplicate to merge into {fullName(survivor)}. Its facts
                move onto {fullName(survivor)}, then it is deleted. This can't
                be undone.
              </Text>
              {others.length === 0 ? (
                <Text style={styles.muted}>
                  There is no one else to merge in.
                </Text>
              ) : (
                others.map((other) => (
                  <Pressable
                    key={other.id}
                    accessibilityRole="button"
                    style={styles.row}
                    onPress={() => confirmMerge(survivor, other)}
                  >
                    <Text style={styles.rowText}>{fullName(other)}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          );
        })()
      )}
    </>
  );
}
