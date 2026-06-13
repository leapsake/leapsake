import { Alert, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import {
  type MilestoneSubjectType,
  type MilestoneTimelineEntry,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
} from "@leapsake/schema";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** The route base for a milestone subject's pages, branching on its type. */
function basePathFor(subjectType: MilestoneSubjectType, id: string): string {
  const segment =
    subjectType === "person"
      ? "people"
      : subjectType === "pet"
        ? "pets"
        : "relationships";
  return `/${segment}/${id}`;
}

/**
 * The Milestones section shared by the Person, Pet, and relationship detail
 * screens, ported from the desktop `MilestonesSection`. It lists the subject's
 * timeline: an entry's **own** milestones are editable in place (Edit / Remove),
 * while milestones drawn from a relationship the subject participates in are shown
 * read-only and link out to that relationship's page (labelled "· with
 * <partner>"). On the relationship detail screen every entry is `own`.
 *
 * Remove deletes in place via a native `Alert` confirm — mirroring the person/pet
 * delete — then calls `onChanged` so the detail screen refetches its view.
 */
export function MilestonesSection({
  subjectType,
  subjectId,
  entries,
  onChanged,
}: {
  subjectType: MilestoneSubjectType;
  subjectId: string;
  entries: MilestoneTimelineEntry[];
  onChanged: () => void;
}) {
  const core = useCore();
  const basePath = basePathFor(subjectType, subjectId);

  function confirmRemove(entry: MilestoneTimelineEntry) {
    const label = milestoneLabel(entry.milestone);
    Alert.alert("Remove milestone", `Remove ${label}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          core.milestones.softDelete(entry.milestone.id).then(
            () => onChanged(),
            (e: unknown) => Alert.alert("Couldn't remove", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Milestones</Text>
        <Link href={`${basePath}/milestones/new`} style={styles.link}>
          Add milestone
        </Link>
      </View>

      {entries.length === 0 ? (
        <Text style={styles.muted}>No milestones yet.</Text>
      ) : (
        entries.map((entry) => {
          const milestone = entry.milestone;
          const icon = kindDefs[milestone.kind].icon;
          const date = formatMilestoneDate(milestone);
          const fromRelationship = entry.origin === "relationship";
          const heading =
            (icon ? `${icon} ` : "") +
            milestoneLabel(milestone) +
            (fromRelationship && entry.otherLabel
              ? ` · with ${entry.otherLabel}`
              : "");
          return (
            <View key={milestone.id} style={styles.row}>
              <Text style={styles.rowText}>{heading}</Text>
              <View style={styles.rowMeta}>
                <Text style={styles.muted}>{date === "" ? "—" : date}</Text>
                {/* A relationship-origin entry is read-only: it lives on the
                    relationship, which owns its Edit/Remove — link out to it. */}
                {fromRelationship ? (
                  entry.relationshipId !== null ? (
                    <Link
                      href={`/relationships/${entry.relationshipId}`}
                      style={styles.link}
                    >
                      Details
                    </Link>
                  ) : null
                ) : (
                  <View style={styles.rowActions}>
                    <Link
                      href={`${basePath}/milestones/${milestone.id}/edit`}
                      style={styles.link}
                    >
                      Edit
                    </Link>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => confirmRemove(entry)}
                    >
                      <Text style={[styles.link, styles.danger]}>Remove</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
