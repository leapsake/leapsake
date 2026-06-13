import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { Person, Pet, Tag } from "@leapsake/schema";
import { fullName, tagLabel } from "@leapsake/schema";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { colors, styles } from "../../../lib/styles";

// Tag detail, ported from desktop's TagView: everything carrying a given tag,
// grouped by entity type. People and pets are both taggable; each group renders
// only when non-empty, and an empty tag shows a placeholder. This is the landing
// page for a standalone tag search result.
export default function TagDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const load = useCallback(
    () =>
      Promise.all([
        core.tags.get(id),
        core.tags.peopleForTag(id),
        core.tags.petsForTag(id),
      ]),
    [core, id],
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

  const [tag, people, pets]: [Tag | undefined, Person[], Pet[]] = data;

  if (tag === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Tag" }} />
        <Text style={styles.muted}>This tag no longer exists.</Text>
      </View>
    );
  }

  const label = tagLabel(tag.name);
  const empty = people.length === 0 && pets.length === 0;

  function confirmDelete() {
    Alert.alert("Delete tag", `Delete #${label}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          core.tags.softDelete(id).then(
            () => router.back(),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: `#${label}` }} />

      {empty && <Text style={styles.muted}>Nothing has this tag.</Text>}

      {people.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>People</Text>
          {people.map((person) => (
            <Link
              key={person.id}
              href={`/people/${person.id}`}
              style={styles.row}
            >
              <Text style={[styles.rowText, { color: colors.accent }]}>
                {fullName(person)}
              </Text>
            </Link>
          ))}
        </View>
      )}

      {pets.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pets</Text>
          {pets.map((pet) => (
            <Link key={pet.id} href={`/pets/${pet.id}`} style={styles.row}>
              <Text style={[styles.rowText, { color: colors.accent }]}>
                {pet.name}
              </Text>
            </Link>
          ))}
        </View>
      )}

      <Pressable accessibilityRole="button" onPress={confirmDelete}>
        <Text style={[styles.link, styles.danger]}>Delete tag</Text>
      </Pressable>
    </ScrollView>
  );
}
