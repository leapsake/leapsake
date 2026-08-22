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
import { EditLink } from "../../../components/EditLink";
import { GiftsSection } from "../../../components/GiftsSection";
import { HolidaysSection } from "../../../components/HolidaysSection";
import { MentionedInSection } from "../../../components/MentionedInSection";
import { MilestonesSection } from "../../../components/MilestonesSection";
import { PetDetailFields } from "../../../components/PetDetailFields";
import { RecordTimestamps } from "../../../components/RecordTimestamps";
import { RelationshipsSection } from "../../../components/RelationshipsSection";
import { TagsField } from "../../../components/TagsField";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

// Pet detail, ported from desktop's PetView (name, gender, tags, timestamps,
// relationships, milestones, holidays, gifts).
export default function PetDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Load the view and the reminders that @mention this pet together, so the
  // "Mentioned in" backlink refreshes on focus alongside the rest of the page.
  const load = useCallback(
    () =>
      Promise.all([
        core.views.pet(id),
        core.reminders.mentioning("pet", id),
        core.holidays.listForBearer("pet", id),
        // The Gifts section: what's suggested for them, and what they've been
        // given. Capturing a new one is `/gifts/new`'s job, so the idea pool it
        // autocompletes against is loaded there rather than here.
        core.gifts.recipients.listForRecipient("pet", id),
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

  const [view, mentionedIn, holidays, gifts] = data;
  if (view === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  const { pet, gender, tags, timeline, relationships } = view;

  function confirmDelete() {
    Alert.alert("Delete pet", `Delete ${pet.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          core.pets.softDelete(id).then(
            // `dismissTo` for the same reason as the person page: the catalog is
            // below us in the tab navigator, not a screen to replace this one
            // with. See `app/people/[id]/index.tsx`.
            () => router.dismissTo("/people"),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {/* An Edit beside each part of the record rather than one in the header —
          see the person screen, which this mirrors. */}
      <Stack.Screen options={{ title: pet.name }} />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Details</Text>
          <EditLink href={`/pets/${id}/edit`} what={pet.name} />
        </View>
        <PetDetailFields pet={pet} gender={gender.value} />
      </View>

      <MilestonesSection
        bearerType="pet"
        bearerId={pet.id}
        entries={timeline}
        onChanged={reload}
      />

      <RelationshipsSection
        subjectType="pet"
        subjectId={pet.id}
        relationships={relationships}
        onChanged={reload}
      />

      <HolidaysSection bearerType="pet" bearerId={pet.id} holidays={holidays} />

      <GiftsSection gifts={gifts} />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Tags</Text>
          <EditLink href={`/pets/${id}/tags/edit`} what="tags" />
        </View>
        <TagsField tags={tags} />
      </View>

      <MentionedInSection reminders={mentionedIn} />

      {/* Above the timestamps, so the page ends on the record's bookkeeping
          rather than on a destructive button — see the person screen. */}
      <Pressable accessibilityRole="button" onPress={confirmDelete}>
        <Text style={[styles.link, styles.danger]}>Delete pet</Text>
      </Pressable>

      {/* Bookkeeping, as a caption at the foot of the screen — see the person
          screen, which this mirrors. */}
      <RecordTimestamps createdAt={pet.createdAt} updatedAt={pet.updatedAt} />
    </ScrollView>
  );
}
