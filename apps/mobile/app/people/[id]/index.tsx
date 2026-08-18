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
import { fullName, genderLabel } from "@leapsake/schema";
import { formatTimestamp } from "@leapsake/ui/headless";
import { ContactsSection } from "../../../components/ContactsSection";
import { GiftsSection } from "../../../components/GiftsSection";
import { HolidaysSection } from "../../../components/HolidaysSection";
import { MentionedInSection } from "../../../components/MentionedInSection";
import { MilestonesSection } from "../../../components/MilestonesSection";
import { RelationshipsSection } from "../../../components/RelationshipsSection";
import { TagsField } from "../../../components/TagsField";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { colors, styles } from "../../../lib/styles";

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

// Person detail, ported from desktop's PersonView (core fields, gender, tags,
// timestamps, relationships, milestones, holidays, gifts, contacts).
export default function PersonDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Load the view and the reminders that @mention this person together, so the
  // "Mentioned in" backlink refreshes on focus alongside the rest of the page.
  const load = useCallback(
    () =>
      Promise.all([
        core.views.person(id),
        core.reminders.mentioning("person", id),
        // The whole catalog with this person's answers — one read serving both
        // the Holidays section's list and its add-field's suggestions.
        core.holidays.listForBearer("person", id),
        // The Gifts section: what's suggested for them, and what they've been
        // given. Capturing a new one is `/gifts/new`'s job, so the idea pool it
        // autocompletes against is loaded there rather than here.
        core.gifts.suggestions.listForRecipient("person", id),
        core.gifts.given.listForRecipient("person", id),
        // Unresolved pairs this person is half of — both people in a pair carry
        // the banner, so whichever one the user opens leads back to the review.
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

  const [
    view,
    mentionedIn,
    holidays,
    giftSuggestions,
    giftsGiven,
    duplicateCandidates,
  ] = data;
  if (view === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  const { person, gender, tags, timeline, relationships, contactMethods } =
    view;
  const genderText = gender.value === null ? "—" : genderLabel[gender.value];

  function confirmDelete() {
    Alert.alert("Delete person", `Delete ${fullName(person)}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          core.people.softDelete(id).then(
            () => router.replace("/people"),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen
        options={{
          title: fullName(person),
          headerRight: () => (
            <Link href={`/people/${person.id}/edit`} style={styles.link}>
              Edit
            </Link>
          ),
        }}
      />

      {/* Both halves of an unresolved pair carry this, so the way back to the
          review is on whichever person the user opens. It stays until the pair
          is merged or marked "not the same" — the only two things that take it
          out of the candidate set. */}
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

      <DetailField label="First name" value={person.firstName} />
      <DetailField label="Middle name" value={person.middleName ?? "—"} />
      <DetailField label="Last name" value={person.lastName} />
      <DetailField label="Gender" value={genderText} />

      <ContactsSection
        ownerId={person.id}
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
        suggestions={giftSuggestions}
        gifts={giftsGiven}
        onChanged={reload}
      />

      <TagsField tags={tags} />

      <MentionedInSection reminders={mentionedIn} />

      {/* Bookkeeping, not what the page is about — it sits below the sections a
          reader came for, just above the destructive end of the screen. */}
      <DetailField label="Created" value={formatTimestamp(person.createdAt)} />
      <DetailField
        label="Last Updated"
        value={formatTimestamp(person.updatedAt)}
      />

      {/* Offered only when detection has something to offer it for. It used to
          stand on every person, advertising a chore on pages where there was
          nothing to merge — the same thing the People list's duplicates link
          stopped doing. The banner above is the same trip by a shorter road when
          the pair is already known; this stays because merging is the act, and
          reviewing is only the way in. */}
      {duplicateCandidates.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/people/${person.id}/merge`)}
        >
          <Text style={styles.link}>Merge duplicate…</Text>
        </Pressable>
      )}

      <Pressable accessibilityRole="button" onPress={confirmDelete}>
        <Text style={[styles.link, styles.danger]}>Delete person</Text>
      </Pressable>
    </ScrollView>
  );
}
