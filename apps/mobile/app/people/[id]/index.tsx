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
import { fullName } from "@leapsake/schema";
import { ContactsSection } from "../../../components/ContactsSection";
import { EditLink } from "../../../components/EditLink";
import { GiftsSection } from "../../../components/GiftsSection";
import { HolidaysSection } from "../../../components/HolidaysSection";
import { MentionedInSection } from "../../../components/MentionedInSection";
import { MilestonesSection } from "../../../components/MilestonesSection";
import { PersonDetailFields } from "../../../components/PersonDetailFields";
import { RecordTimestamps } from "../../../components/RecordTimestamps";
import { RelationshipsSection } from "../../../components/RelationshipsSection";
import { TagsField } from "../../../components/TagsField";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { personTitle } from "../../../lib/record-title";
import { colors, styles } from "../../../lib/styles";

// A person's page; each part carries its own Edit, beside what it changes.
export default function PersonDetailScreen() {
  const core = useCore();
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

  const [view, mentionedIn, holidays, gifts, duplicateCandidates] = data;
  if (view === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  const { person, gender, tags, timeline, relationships, contactMethods } =
    view;

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
      <Stack.Screen options={{ title: personTitle(person) }} />

      {/* Until the pair is merged or marked "not the same". */}
      {duplicateCandidates.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/duplicates?for=${person.id}`)}
          style={styles.row}
        >
          <Text style={[styles.link, { color: colors.accent }]}>
            {duplicateCandidates.length === 1
              ? "Someone else in your list looks like the same person. Review"
              : `${duplicateCandidates.length} other people in your list look like the same person. Review`}
          </Text>
        </Pressable>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Details</Text>
          <EditLink href={`/people/${id}/edit`} what={fullName(person)} />
        </View>
        <PersonDetailFields person={person} gender={gender.value} />
      </View>

      <ContactsSection
        ownerId={person.id}
        subjectName={fullName(person)}
        methods={contactMethods}
        onChanged={reload}
      />

      <MilestonesSection
        bearerType="person"
        bearerId={person.id}
        entries={timeline}
        onChanged={reload}
      />

      <RelationshipsSection
        subjectType="person"
        subjectId={person.id}
        relationships={relationships}
        onChanged={reload}
      />

      <HolidaysSection
        bearerType="person"
        bearerId={person.id}
        holidays={holidays}
        onChanged={reload}
      />

      <GiftsSection
        recipientType="person"
        recipientId={person.id}
        gifts={gifts}
        onChanged={reload}
      />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Tags</Text>
          <EditLink
            href={`/people/${id}/tags/edit`}
            what="tags"
            action={tags.length === 0 ? "add" : "edit"}
          />
        </View>
        <TagsField tags={tags} />
      </View>

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
      <Pressable accessibilityRole="button" onPress={confirmDelete}>
        <Text style={[styles.link, styles.danger]}>Delete person</Text>
      </Pressable>

      <RecordTimestamps
        createdAt={person.createdAt}
        updatedAt={person.updatedAt}
      />
    </ScrollView>
  );
}
