import { useCallback } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { GiftIdea, Person, Pet, Reminder, Tag } from "@leapsake/schema";
import { fullName, reminderLabel } from "@leapsake/schema";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { personHref, petHref, tagTitle } from "../../../lib/record-title";
import { colors, styles } from "../../../lib/styles";
import { Button } from "../../../components/Button";
import { LoadState } from "../../../components/LoadState";

// Everything wearing a tag, grouped by type. A gift idea has no read-only
// view, so its row opens the idea's edit screen.
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
        core.tags.remindersForTag(id),
        core.tags.giftIdeasForTag(id),
      ]),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

  if (error !== null || data === null) return <LoadState error={error} />;

  const [tag, people, pets, reminders, giftIdeas]: [
    Tag | undefined,
    Person[],
    Pet[],
    Reminder[],
    GiftIdea[],
  ] = data;

  if (tag === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Tag" }} />
        <Text style={styles.muted}>This tag no longer exists.</Text>
      </View>
    );
  }

  // The tag's one name: title, delete prompt, and what links here send.
  const label = tagTitle(tag);
  const empty =
    people.length === 0 &&
    pets.length === 0 &&
    reminders.length === 0 &&
    giftIdeas.length === 0;

  function confirmDelete() {
    Alert.alert("Delete tag", `Delete ${label}?`, [
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
      <Stack.Screen options={{ title: label }} />

      {empty && <Text style={styles.muted}>Nothing has this tag.</Text>}

      {people.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>People</Text>
          {people.map((person) => (
            <Link key={person.id} href={personHref(person)} style={styles.row}>
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
            <Link key={pet.id} href={petHref(pet)} style={styles.row}>
              <Text style={[styles.rowText, { color: colors.accent }]}>
                {pet.name}
              </Text>
            </Link>
          ))}
        </View>
      )}

      {reminders.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reminders</Text>
          {reminders.map((reminder) => (
            <Link
              key={reminder.id}
              href={{
                pathname: "/reminders/[id]",
                params: { id: reminder.id },
              }}
              style={styles.row}
            >
              <Text style={[styles.rowText, { color: colors.accent }]}>
                {reminderLabel(reminder)}
              </Text>
            </Link>
          ))}
        </View>
      )}

      {giftIdeas.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gift ideas</Text>
          {giftIdeas.map((idea) => (
            <Link
              key={idea.id}
              href={`/gifts/${idea.id}/edit`}
              style={styles.row}
            >
              <Text style={[styles.rowText, { color: colors.accent }]}>
                {idea.title}
              </Text>
            </Link>
          ))}
        </View>
      )}

      <Button label="Delete tag" tone="destructive" onPress={confirmDelete} />
    </ScrollView>
  );
}
