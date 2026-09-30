import { Alert } from "react-native";
import { useRouter } from "expo-router";
import {
  type MilestoneBearerType,
  type MilestoneTimelineEntry,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
} from "@leapsake/schema";
import { entityBasePath } from "@leapsake/ui/headless";
import { rowMenuItem } from "./RowMenu";
import { RecordSection } from "./RecordSection";
import { SummaryRow } from "./SummaryRow";
import { useCore } from "../lib/core-context";

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
    <RecordSection
      title="Milestones"
      link={{
        href: `${basePath}/milestones/new`,
        what: "milestone",
        action: "add",
      }}
      isEmpty={entries.length === 0}
      emptyText="No milestones yet."
    >
      {entries.map((entry) => {
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
          <SummaryRow
            key={milestone.id}
            title={heading}
            detail={date === "" ? "—" : date}
            menu={
              fromRelationship && entry.relationshipId === null
                ? undefined
                : {
                    subject: milestoneLabel(milestone),
                    title: heading,
                    // Read-only here: the relationship owns its editing.
                    items: fromRelationship
                      ? [
                          rowMenuItem.details(() =>
                            router.push(
                              `/relationships/${entry.relationshipId}`,
                            ),
                          ),
                        ]
                      : [
                          rowMenuItem.edit(() =>
                            router.push(
                              `${basePath}/milestones/${milestone.id}/edit`,
                            ),
                          ),
                          rowMenuItem.remove(() => confirmRemove(entry)),
                        ],
                  }
            }
          />
        );
      })}
    </RecordSection>
  );
}
