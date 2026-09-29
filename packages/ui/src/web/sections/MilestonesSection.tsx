import {
  type MilestoneBearerType,
  type MilestoneTimelineEntry,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
  preferredBearerType,
} from "@leapsake/schema";
import { entityBasePath } from "../../headless/routes.js";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { DataTable } from "../primitives/DataTable.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * A bearer's milestones: its own are editable here, while a relationship's
 * are read-only and link to the relationship's page.
 */
export function MilestonesSection({
  bearerType,
  bearerId,
  entries,
}: {
  bearerType: MilestoneBearerType;
  bearerId: string;
  entries: readonly MilestoneTimelineEntry[];
}) {
  const { Link } = useUi();
  const m = useMessages();
  const basePath = `${entityBasePath(bearerType)}/${bearerId}`;

  return (
    <Section
      title={m.milestones.title}
      actions={
        <Link href={`${basePath}/milestones/new`}>{m.milestones.add}</Link>
      }
    >
      {entries.length === 0 ? (
        <EmptyState>{m.milestones.empty}</EmptyState>
      ) : (
        <DataTable
          items={entries}
          getKey={(entry) => entry.milestone.id}
          columns={[
            {
              header: m.milestones.columnMilestone,
              cell: (entry) => {
                const icon = kindDefs[entry.milestone.kind].icon;
                const label = milestoneLabel(entry.milestone);
                const named =
                  entry.origin === "relationship" && entry.otherLabel
                    ? m.milestones.withPartner(label, entry.otherLabel)
                    : label;
                return `${icon ? `${icon} ` : ""}${named}`;
              },
            },
            {
              header: m.milestones.columnDate,
              cell: (entry) => {
                const date = formatMilestoneDate(entry.milestone);
                return date === "" ? m.common.none : date;
              },
            },
            {
              header: "",
              cell: (entry) => {
                const milestone = entry.milestone;
                if (entry.origin === "relationship") {
                  return (
                    <Link href={`/relationships/${entry.relationshipId}`}>
                      {m.milestones.view}
                    </Link>
                  );
                }
                // A wedding stored while the spouse was unknown can be bound.
                const canRebind =
                  bearerType === "person" &&
                  milestone.bearerType === "person" &&
                  preferredBearerType(milestone.kind) === "relationship";
                const milestonePath = `${basePath}/milestones/${milestone.id}`;
                return (
                  <>
                    <Link href={`${milestonePath}/edit`}>{m.common.edit}</Link>{" "}
                    <Link href={`${milestonePath}/delete`}>
                      {m.common.remove}
                    </Link>
                    {canRebind ? (
                      <>
                        {" "}
                        <Link href={`${milestonePath}/rebind`}>
                          {m.milestones.setSpouse}
                        </Link>
                      </>
                    ) : null}
                  </>
                );
              },
            },
          ]}
        />
      )}
    </Section>
  );
}
