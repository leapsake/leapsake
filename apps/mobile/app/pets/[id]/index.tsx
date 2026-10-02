import { useCallback } from "react";
import { Alert, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { RecordSection } from "../../../components/RecordSection";
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
import { petTitle } from "../../../lib/record-title";
import { styles } from "../../../lib/styles";
import { Button } from "../../../components/Button";
import { LoadState } from "../../../components/LoadState";

// A pet's page; each part carries its own Edit, as on a person's.
export default function PetDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(
    () =>
      Promise.all([
        core.views.pet(id),
        core.reminders.mentioning("pet", id),
        core.holidays.listForBearer("pet", id),
        core.gifts.recipients.listForRecipient("pet", id),
      ]),
    [core, id],
  );
  const { data, error, reload } = useFocusedData(load);

  if (error !== null || data === null) return <LoadState error={error} />;

  const [view, mentionedIn, holidays, gifts] = data;
  if (view === null) return <LoadState error={null} />;

  const { pet, gender, tags, timeline, relationships } = view;

  function confirmDelete() {
    Alert.alert("Delete pet", `Delete ${pet.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          core.pets.softDelete(id).then(
            // `dismissTo`: the catalog is in the tabs underneath.
            () => router.dismissTo("/people"),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {/* `petTitle`, which every link to this page also sends ahead. */}
      <Stack.Screen options={{ title: petTitle(pet) }} />

      <RecordSection
        title="Details"
        link={{ href: `/pets/${id}/edit`, what: pet.name }}
      >
        <PetDetailFields pet={pet} gender={gender.value} />
      </RecordSection>

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
        gifts={gifts}
        onChanged={reload}
      />

      <RecordSection
        title="Tags"
        link={{
          href: `/pets/${id}/tags/edit`,
          what: "tags",
          action: tags.length === 0 ? "add" : "edit",
        }}
      >
        <TagsField tags={tags} />
      </RecordSection>

      <MentionedInSection reminders={mentionedIn} />

      {/* Above the timestamps, so the page ends on bookkeeping. */}
      <Button label="Delete pet" tone="destructive" onPress={confirmDelete} />

      <RecordTimestamps createdAt={pet.createdAt} updatedAt={pet.updatedAt} />
    </ScrollView>
  );
}
