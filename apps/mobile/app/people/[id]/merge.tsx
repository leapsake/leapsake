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
import { type Person, fullName } from "@leapsake/schema";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

/**
 * Merge a duplicate person into the one being viewed (the survivor). Pick the
 * duplicate from the list; its relationships, tags, milestones, contact methods,
 * and dismissals move onto the survivor, then it is removed. Mirrors the desktop
 * merge screen and the existing destructive-action confirm pattern — honest that
 * it can't be undone.
 */
export default function PersonMergeScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
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
              () => router.replace(`/people/${survivor.id}`),
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
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : data === null || data.person === undefined ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : (
        (() => {
          const survivor = data.person;
          const others = data.people.filter((p) => p.id !== survivor.id);
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
