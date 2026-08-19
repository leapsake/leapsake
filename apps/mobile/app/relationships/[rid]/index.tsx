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
import type { MilestoneTimelineEntry } from "@leapsake/schema";
import { MilestonesSection } from "../../../components/MilestonesSection";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

/** The route base for a partner entity's pages, branching on its type. */
function entityPath(type: "person" | "pet", id: string): string {
  return `/${type === "person" ? "people" : "pets"}/${id}`;
}

// Relationship detail, ported from desktop's RelationshipView: the two partners
// (each a link to their page) and the relationship's own milestones (a Wedding,
// Met, First Date — facts that belong to the edge, not either partner). Roles are
// re-set on a partner's own edit form, which is where their relationships live;
// this page owns the relationship's milestones and a delete.
//
// It keeps the in-place Milestones section (the person and pet screens render the
// same one `readOnly`) because those milestones are the whole of this page: there
// is no record form here to move them into.
export default function RelationshipDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { rid } = useLocalSearchParams<{ rid: string }>();
  const load = useCallback(() => core.views.relationship(rid), [core, rid]);
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

  const { title, partners, milestones } = view;

  // The relationship's own milestones, adapted to the timeline-entry shape the
  // shared section renders — all `own` here, since they live on this edge.
  const entries: MilestoneTimelineEntry[] = milestones.map((milestone) => ({
    milestone,
    origin: "own",
    relationshipId: null,
    otherLabel: null,
  }));

  function confirmDelete() {
    Alert.alert("Delete relationship", `Delete ${title}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          core.relationships.softDelete(rid).then(
            () => router.back(),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title }} />

      {partners.map((partner) => (
        <View key={`${partner.type}:${partner.id}`} style={styles.field}>
          <Text style={styles.fieldLabel}>{partner.roleLabel}</Text>
          <Link
            href={entityPath(partner.type, partner.id)}
            style={styles.fieldValue}
          >
            {partner.label}
          </Link>
        </View>
      ))}

      <MilestonesSection
        bearerType="relationship"
        bearerId={rid}
        entries={entries}
        onChanged={reload}
      />

      <Pressable accessibilityRole="button" onPress={confirmDelete}>
        <Text style={[styles.link, styles.danger]}>Delete relationship</Text>
      </Pressable>
    </ScrollView>
  );
}
