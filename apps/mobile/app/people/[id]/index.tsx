import { useCallback } from "react";
import { Alert, Pressable, ScrollView, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { fullName } from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { RecordFacts } from "../../../components/RecordFacts";
import { RecordSection } from "../../../components/RecordSection";
import { MentionedInSection } from "../../../components/MentionedInSection";
import { PersonDetailFields } from "../../../components/PersonDetailFields";
import { RecordTimestamps } from "../../../components/RecordTimestamps";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import {
  deceasedTitle,
  isDeceased,
  personTitle,
} from "../../../lib/record-title";
import { colors, styles } from "../../../lib/styles";
import { Button } from "../../../components/Button";
import { LoadState } from "../../../components/LoadState";

// A person's page; each part carries its own Edit, beside what it changes.
export default function PersonDetailScreen() {
  const core = useCore();
  const m = useMessages();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(
    () =>
      Promise.all([
        core.views.person(id),
        core.reminders.mentioning("person", id),
        // The whole catalog with this person's answers.
        core.holidays.listForBearer("person", id),
        core.gifts.recipients.listForRecipient("person", id),
        // Both people in an unresolved pair carry the banner.
        core.duplicates.findFor(id),
      ]),
    [core, id],
  );
  const { data, error, reload } = useFocusedData(load);

  if (error !== null || data === null) return <LoadState error={error} />;

  const [view, mentionedIn, holidays, gifts, duplicateCandidates] = data;
  if (view === null) return <LoadState error={null} />;

  const { person, gender, timeline } = view;

  function confirmDelete() {
    Alert.alert("Delete person", `Delete ${fullName(person)}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          core.people.softDelete(id).then(
            // `dismissTo`: People & Pets is in the tabs underneath, and
            // `replace` would stack a second `(tabs)`.
            () => router.dismissTo("/people"),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {/* `personTitle`, which every link to this page also sends ahead. */}
      <Stack.Screen
        options={{
          title: deceasedTitle(personTitle(person), isDeceased(timeline)),
        }}
      />

      {/* Until the pair is merged or marked "not the same". */}
      {duplicateCandidates.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/duplicates?for=${person.id}`)}
          style={styles.row}
        >
          <Text style={[styles.rowText, { color: colors.accent }]}>
            {m.person.duplicates(duplicateCandidates.length)}{" "}
            {m.person.reviewDuplicates}
          </Text>
        </Pressable>
      )}

      <RecordSection
        title="Details"
        link={{ href: `/people/${id}/edit`, what: fullName(person) }}
      >
        <PersonDetailFields person={person} gender={gender.value} />
      </RecordSection>

      <RecordFacts
        type="person"
        id={person.id}
        subjectName={fullName(person)}
        view={view}
        holidays={holidays}
        gifts={gifts}
        onChanged={reload}
      />

      <MentionedInSection reminders={mentionedIn} />

      {/* Only when detection has something to merge. */}
      {duplicateCandidates.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/people/${person.id}/merge`)}
        >
          <Text style={styles.link}>Merge duplicate…</Text>
        </Pressable>
      )}

      {/* Above the timestamps, so the page ends on bookkeeping. */}
      <Button
        label="Delete person"
        tone="destructive"
        onPress={confirmDelete}
      />

      <RecordTimestamps
        createdAt={person.createdAt}
        updatedAt={person.updatedAt}
      />
    </ScrollView>
  );
}
