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
import { formatTimestamp } from "@leapsake/ui/headless";
import { DetailField } from "../../../components/DetailField";
import { EditableTags } from "../../../components/EditableTags";
import { GiftsSection } from "../../../components/GiftsSection";
import { HolidaysSection } from "../../../components/HolidaysSection";
import { MentionedInSection } from "../../../components/MentionedInSection";
import { MilestonesSection } from "../../../components/MilestonesSection";
import { PetDetailFields } from "../../../components/PetDetailFields";
import { RelationshipsSection } from "../../../components/RelationshipsSection";
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
        core.gifts.suggestions.listForRecipient("pet", id),
        core.gifts.given.listForRecipient("pet", id),
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

  const [view, mentionedIn, holidays, giftSuggestions, giftsGiven] = data;
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
            () => router.replace("/people"),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {/* No `headerRight`: this pet's own fields are edited from their own rows
          below, so the nav bar has nothing left to hold. */}
      <Stack.Screen options={{ title: pet.name }} />

      <PetDetailFields
        pet={pet}
        gender={gender.value}
        tags={tags}
        onChanged={reload}
      />

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

      <HolidaysSection
        bearerType="pet"
        bearerId={pet.id}
        holidays={holidays}
        onChanged={reload}
      />

      <GiftsSection
        recipientType="pet"
        recipientId={pet.id}
        suggestions={giftSuggestions}
        gifts={giftsGiven}
        onChanged={reload}
      />

      <EditableTags
        tags={tags}
        onSave={async (tagNames) => {
          await core.pets.update(pet.id, {}, tagNames);
          reload();
        }}
      />

      <MentionedInSection reminders={mentionedIn} />

      {/* Bookkeeping, not what the page is about — it sits below the sections a
          reader came for, just above the destructive end of the screen. */}
      <DetailField label="Created" value={formatTimestamp(pet.createdAt)} />
      <DetailField
        label="Last Updated"
        value={formatTimestamp(pet.updatedAt)}
      />

      <Pressable accessibilityRole="button" onPress={confirmDelete}>
        <Text style={[styles.link, styles.danger]}>Delete pet</Text>
      </Pressable>
    </ScrollView>
  );
}
