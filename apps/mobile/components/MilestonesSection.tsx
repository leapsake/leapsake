import { Alert, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import {
  type MilestoneBearerType,
  type MilestoneTimelineEntry,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
} from "@leapsake/schema";
import { entityBasePath } from "@leapsake/ui/headless";
import { RowMenu, rowMenuItem } from "./RowMenu";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * A bearer's milestones, and a person's or pet's from their relationships,
 * which link out to the edge they live on. Remove confirms, then refetches.
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
  const router = useRouter();
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
                {/* Read-only here: the relationship owns its editing. */}
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
                  <RowMenu
                    subject={heading}
                    items={[
                      rowMenuItem.edit(() =>
                        router.push(
                          `${basePath}/milestones/${milestone.id}/edit`,
                        ),
                      ),
                      rowMenuItem.remove(() => confirmRemove(entry)),
                    ]}
                  />
                )}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
