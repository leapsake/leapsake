import { Alert, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import {
  type MilestoneBearerType,
  type MilestoneTimelineEntry,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
} from "@leapsake/schema";
import { entityBasePath } from "@leapsake/ui/headless";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * The Milestones section shared by the Person, Pet, and relationship detail
 * screens, ported from the desktop `MilestonesSection`. It lists the bearer's
 * timeline: an entry's **own** milestones and, on a person or pet, the ones drawn
 * from a relationship they participate in — those labelled "· with <partner>" and
 * linking out to that relationship's page, because they are stored on the edge.
 *
 * Every bearer gets the same Add / Edit / Remove. The person and pet screens
 * rendered it `readOnly` for a while, their milestones having been folded into
 * the one form behind the page's Edit; that prop is gone with the form, and
 * three screens now agree on what a milestone row can do.
 *
 * Remove deletes in place via a native `Alert` confirm — mirroring the person/pet
 * delete — then calls `onChanged` so the detail screen refetches its view.
 */
export function MilestonesSection({
  bearerType,
  bearerId,
  entries,
  onChanged,
}: {
  bearerType: MilestoneBearerType;
  bearerId: string;
  entries: MilestoneTimelineEntry[];
  onChanged: () => void;
}) {
  const core = useCore();
  const basePath = `${entityBasePath(bearerType)}/${bearerId}`;

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
                {/* A relationship-origin entry is read-only wherever it appears:
                    it lives on the relationship, which owns its editing — link
                    out to it. */}
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
