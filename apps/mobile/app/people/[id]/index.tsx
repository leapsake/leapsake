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
import { fullName, genderLabel, tagLabel } from "@leapsake/schema";
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

// Person detail, ported from desktop's PersonView (core fields, gender, tags,
// timestamps, relationships, milestones). The contacts section is deferred to a
// later increment.
export default function PersonDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => core.views.person(id), [core, id]);
  const { data: view, error, reload } = useFocusedData(load);

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }

  if (view === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  const { person, gender, tags, timeline, relationships } = view;
  const genderText = gender.value === null ? "—" : genderLabel[gender.value];
  const tagsText =
    tags.length === 0 ? "—" : tags.map((tag) => tagLabel(tag.name)).join(" ");

  function confirmDelete() {
    Alert.alert("Delete person", `Delete ${fullName(person)}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          core.people.softDelete(id).then(
            () => router.replace("/"),
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

      <DetailField label="First name" value={person.firstName} />
      <DetailField label="Middle name" value={person.middleName ?? "—"} />
      <DetailField label="Last name" value={person.lastName} />
      <DetailField label="Gender" value={genderText} />
      <DetailField label="Tags" value={tagsText} />
      <DetailField label="Created" value={formatTimestamp(person.createdAt)} />
      <DetailField label="Updated" value={formatTimestamp(person.updatedAt)} />

      <RelationshipsSection
        subjectType="person"
        subjectId={person.id}
        relationships={relationships}
        onChanged={reload}
      />

      <MilestonesSection
        subjectType="person"
        subjectId={person.id}
        entries={timeline}
        onChanged={reload}
      />

      <Pressable accessibilityRole="button" onPress={confirmDelete}>
        <Text style={[styles.link, styles.danger]}>Delete person</Text>
      </Pressable>
    </ScrollView>
  );
}
