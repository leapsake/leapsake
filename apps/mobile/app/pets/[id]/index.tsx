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
import { genderLabel, tagLabel } from "@leapsake/schema";
import { HolidaysSection } from "../../../components/HolidaysSection";
import { MentionedInSection } from "../../../components/MentionedInSection";
import { MilestonesSection } from "../../../components/MilestonesSection";
import { RelationshipsSection } from "../../../components/RelationshipsSection";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

/** Render an epoch-ms timestamp in the device locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

// Pet detail, ported from desktop's PetView (name, gender, tags, timestamps,
// relationships, milestones).
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

  const [view, mentionedIn, holidays] = data;
  if (view === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  const { pet, gender, tags, timeline, relationships } = view;
  const genderText = gender.value === null ? "—" : genderLabel[gender.value];
  const tagsText =
    tags.length === 0 ? "—" : tags.map((tag) => tagLabel(tag.name)).join(" ");

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
      <Stack.Screen
        options={{
          title: pet.name,
          headerRight: () => (
            <Link href={`/pets/${pet.id}/edit`} style={styles.link}>
              Edit
            </Link>
          ),
        }}
      />

      <DetailField label="Name" value={pet.name} />
      <DetailField label="Gender" value={genderText} />
      <DetailField label="Tags" value={tagsText} />
      <DetailField label="Created" value={formatTimestamp(pet.createdAt)} />
      <DetailField label="Updated" value={formatTimestamp(pet.updatedAt)} />

      <RelationshipsSection
        subjectType="pet"
        subjectId={pet.id}
        relationships={relationships}
        onChanged={reload}
      />

      <MilestonesSection
        bearerType="pet"
        bearerId={pet.id}
        entries={timeline}
        onChanged={reload}
      />

      <HolidaysSection
        bearerType="pet"
        bearerId={pet.id}
        holidays={holidays}
        onChanged={reload}
      />

      <MentionedInSection reminders={mentionedIn} />

      <Pressable accessibilityRole="button" onPress={confirmDelete}>
        <Text style={[styles.link, styles.danger]}>Delete pet</Text>
      </Pressable>
    </ScrollView>
  );
}
